'use strict';

var _ = require('lodash');
var debug = require('debug')('routicorn:request');
var thr = require('format-throw');
var ActionRoute = require('./route/action');
var utils = require('./utils');

/**
 * @namespace Request
 */
var req = module.exports = {};

/**
 * The current active Routicorn instance handling this request
 * @memberof Request
 * @name routicorn
 * @type {Routicorn}
 */

/**
 * Generate a path to a named route
 *
 * Usage: `req.generatePath(routeName, [params, [query, [options]]]);`
 *
 * Examples:
 *
 * ```javascript
 * req.generatePath('my-route);
 * req.generatePath('my-route', {my_param: 'foo'});
 * req.generatePath('my-route', {my_param: 'foo'}, {query_param: 'bar'});
 * ```
 *
 * @param {string} routeName Route name
 * @param {object} [params={}] Params to use for path generation
 * @param {object} [query={}] Query parameters
 * @param {object} [options={}] Options. See {@link BaseRoute#generatePath}
 * @returns {string}
 */
req.generatePath = function (routeName, params, query, options) {
  params = _.extend({}, this.params || {}, params || {});

  return this.routicorn.generatePath(routeName, params, query, options);
};

/**
 * Generate an absolute URL to a route
 *
 * Protocol, host and port default to values gathered from the current request. If the app sits
 * behind a proxy, you should use `app.enable('trust proxy');` in order to get reasonable values.
 *
 * Usage: `req.generateUrl(routeName, [params, [query, [options]]]);`
 *
 * Examples:
 *
 * ```javascript
 * req.generateUrl('my-route');
 * req.generateUrl('my-route', {host: 'example.com'});
 * req.generateUrl('my-route', {my_param: 'foo'}, {host: 'example.com'});
 * req.generateUrl('my-route', {my_param: 'foo'}, {query_param: 'bar'}, {host: 'example.com'});
 * ```
 *
 * @param {string} routeName Route name
 * @param {object} [params={}] Params to use for path generation
 * @param {object} [query={}] Query parameters
 * @param {object} [options={}] Options. See {@link BaseRoute#generateUrl}
 * @returns {string}
 */
req.generateUrl = function (routeName, params, query, options) {
  options = options || {};
  options.secure = _.isBoolean(options.secure) ? options.secure : this.secure;
  options.host = _.isString(options.host) ? options.host : this.hostname;
  options.port = options.port === null ? null : (
    _.isNumber(options.port)
      ? parseInt(options.port + '', 10)
      : (this.header['x-forwarded-for'] !== undefined ? null : this.connection.address().port)
  );

  return this.routicorn.generateUrl(routeName, params, query, options);
};

/**
 * Dispatch a sub-request to a named route (without involving the client). For when unicorns must
 * fly up high to get the job done.
 *
 * The sub-request object is a readable stream fully compatible with the Routicorn request API,
 * includes public
 * [http.IncommingMessage](https://nodejs.org/api/http.html#http_http_incomingmessage}) properties,
 * express request API stuff, as well as the following properties:
 *
 * - `subRequest`: `true`
 * - `requestDepth`: Sub-request depth (>= 1)
 * - `parentReq`: Request in whose context the sub-request was created (the "req" in
 * `req.forward()`)
 * - `originalReq`: Points to the original, "root" request, handy when forwarding multiple times
 * - `originalUrl`: URL of the original request
 *
 * The parsed request body is expected to live at the `req.body` property of any request object. It
 * is shared between the original request and any sub-request, even when it's a sub-request that
 * parses the data. Raw rata will be piped from the original request in case it has not been
 * consumed yet. It is generally safe to use
 * [body-parser](https://www.npmjs.com/package/body-parser) or similar middleware in the context of
 * a sub-request as long as it updates `req.body`. Sharing of properties like `files` needs to be
 * handled with custom code.
 *
 * The sub-request does *not* inherit the current request in the architectural sense. Non-default
 * properties of request objects are not copied. You can provide additional properties via the
 * `properties` argument. Note that `params` and `query` will *not* be automatically merged with
 * the according hashes of the original request. A `params` object will be used for path
 * generation, so it must be provided in the `properties` object when there are mandatory route
 * params on the target route or its parents.
 *
 * The forwarding logic always tries to directly invoke the target route action. But depending on
 * your routing setup, it may be necessary to dispatch a sub-request at segments above the target
 * route. That is to ensure that all middleware, that would normally be called, has seen either the
 * parent request or the sub-request. However, when forwarding multiple times, it may happen that
 * middleware gets called multiple times, too.
 *
 * Usage: `req.forward(routeName, [verb], [properties], next)`
 *
 * Examples:
 *
 * ```javascript
 * req.forward('my-route', next);
 * req.forward('my-route', {params: {my_param: 'foo'}}, next);
 * req.forward('my-route', 'post', {params: {my_param: 'foo'}, user: userObj}, next);
 * ```
 *
 * @param {string|ActionRoute} route Target route instance or name of the target route to lookup
 * @param {string} [verb=dynamic] Method to invoke the target route with, defaults to the first
 *   verb defined for the route. If the route matches all HTTP methods, `verb` defaults to the
 *   current request's method.
 * @param {object} [properties={}] Request properties, like `params` and `query`
 * @param {function} next Callback
 */
req.forward = function (route, verb, properties, next) {
  if (arguments.length < 2) {
    thr('Usage: req.forward(routeName, [verb], [properties], next)');
  }

  if (!(route instanceof ActionRoute) && !_.isString(route)) {
    thr(TypeError, 'route must be a string or an instance of ActionRoute');
  }

  if (arguments.length === 2) {
    next = verb;
    verb = properties = undefined;
  } else if (arguments.length === 3) {
    next = properties;
    if (!_.isString(verb)) {
      properties = verb;
      verb = undefined;
    }
  }

  if (!_.isFunction(next)) {
    thr(TypeError, 'next must be a function');
  }

  var invokeActionDirectly = false;
  var res = this.res;
  var currentReq = this;
  var router = this.routicorn;
  var currentRoute = currentReq.routicornRoute;
  var targetRoute = _.isString(route) ? router.getRoute(route) : route;
  var dispatchRoute = targetRoute;

  // Validate target route
  if (!targetRoute) {
    thr('Cannot forward to unknown route');
  } else if (!targetRoute.actionable) {
    thr('Cannot forward to non-action route: %s', route.name);
  } else if (currentRoute === targetRoute && !targetRoute.verbStyle) {
    thr('Cannot forward to same non-verb-style route: %s', route.name);
  }

  // Setup basic properties of the sub request
  var props = _.defaults(properties || {}, {
    method: currentReq.method,
    params: currentReq.params || {},
    query: currentReq.query || {}
  });

  // Check request history and detect loops
  var history = currentReq._routicornForwardHistory;
  if (history) {
    if (history.indexOf(targetRoute) !== -1) {
      thr('[forward] Detected loop: %s', _.map(history, function (r) {
        return r.name;
      }).concat([targetRoute.name]).join(' → '));
    }

    history.push(targetRoute);
  }
  props._routicornForwardHistory = history || [currentRoute, targetRoute];

  // Determine sub-request HTTP method
  verb = props.method = (verb || props.method).toLowerCase();
  if (!targetRoute.handlesMethod(verb)) {
    if (targetRoute.verbs.length === 1) {
      props.method = targetRoute.verb;
    } else {
      thr('Cannot forward to route %s: route cannot handle method %s', targetRoute.name, verb.toUpperCase());
    }
  }

  // Determine optimal dispatch route
  if (currentRoute.isSiblingOf(targetRoute)) {
    invokeActionDirectly = true;
  } else {
    var connectingRoute = currentRoute.findConnectingRoute(targetRoute);
    var parentRoutes = targetRoute.getParentRoutes(connectingRoute);
    // Skip the connecting route itself as its middleware already saw the original request
    if (parentRoutes.length < 2) {
      invokeActionDirectly = true;
    } else {
      dispatchRoute = parentRoutes[1];
    }
  }

  // Generate path
  props.url = targetRoute.generatePath(props.params, props.query, {
    fromRoute: invokeActionDirectly ? dispatchRoute.parentRoute : dispatchRoute
  });

  // Create sub-request
  debug('[forward] Generate sub-request: %s %s', props.method.toUpperCase(), props.url);
  props.app = this.app;
  props.res = res;
  var subReq = utils.createSubRequest(
    currentReq,
    props,
    router.request,
    this.app.request // express application-specific request prototype
  );
  res.req = subReq;

  // Dispatch the request in another execution frame
  setImmediate(function () {
    debug(
      '[forward] %s: %s',
      invokeActionDirectly
        ? 'Directly dispatching sub-request to action on route'
        : 'Dispatching sub-request via ' + dispatchRoute.name + ' to route',
      targetRoute.name
    );

    dispatchRoute._invoke(subReq, res, function (err) {
      subReq._teardownSubRequest();
      res.req = currentReq;
      next(err);
    });
  });
};

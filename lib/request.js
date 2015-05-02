'use strict';

var _ = require('lodash'),
  expressRequestProto = require('express').request,
  utils = require('./utils'),
  debug = require('debug')('routicorn:request'),
  thr = require('throw');

/**
 * Generate a path for a named route
 *
 * Options:
 * - `mixinReqParams`: {boolean} [true] Whether to mixin all properties of the original request
 * params into the params object that the route action is invoked with. Explicitly passed params
 * override request params.
 * - `checkRequirements`: {boolean} {true} Validate the supplied parameters
 *
 * Usage examples:
 *
 * ```javascript
 * req.generatePath('my-route);
 * req.generatePath('my-route', {my_param: 'foo'});
 * req.generatePath('my-route', {my_param: 'foo'}, {mixinReqParams: false});
 * ```
 *
 * @param {string} routeName Route name
 * @param {object} [params={}] Params to use for path generation
 * @param {object} [options={}] Options
 *
 * @returns {string}
 */
exports.generatePath = function generatePath(routeName, params, options) {
  if (!_.isString(routeName)) {
    throw new TypeError('routeName must be a string');
  }

  params = params || {};
  options = options || {};

  if (options.mixinReqParams !== false) {
    params = _.extend({}, this.params || {}, params || {});
  }

  return this.routicorn.generatePath(routeName, params, options.checkRequirements !== false);
};


/**
 * Dispatch a sub-request to a named route
 *
 * The sub-request object is a readable stream fully compatible with express and Routicorn request
 * APIs, including public
 * [http.IncommingMessage](https://nodejs.org/api/http.html#http_http_incomingmessage}) properties
 * and the following:
 *
 * - `parentReq`: Request in whose context the sub-request was created
 * - `originalReq`: Points to the original, "root" request, handy when forwarding multiple times
 * - `body`: Always the same as the original request's body property. Data will be piped from
 * the original request in case it has not been consumed yet. It is safe to use body-parser or
 * similar middleware in the context of a route invoked by a sub-request.
 *
 * The sub-request does *not* inherit the current request. You can provide additional properties
 * via the `properties` argument. Note that `params` and `query` will *not* be automatically merged
 * with the according hashes of the original request. A `params` object will be used for path
 * generation, so it must be provided in the `properties` object when there are mandatory route
 * params on the target route or its parents.
 *
 * The forwarding logic always tries to directly invoke the route action circumventing the express
 * routers. But depending on your routing setup, it may be necessary to dispatch sub-requests at
 * segments above the target route. That is to ensure that all middleware, that would normally be
 * called by express, has seen either the current request or the sub-request. However, when
 * forwarding multiple times, it may happen that middleware gets called multiple times, too.
 *
 * Usage examples:
 *
 * ```javascript
 * // Will use all props and params of the current request for the sub-request
 * req.forward('my-route', next);
 *
 * // Will only use the provided params (and props) for the sub-request.
 * req.forward('my-route', {params: {my_param: 'foo'}}, next);
 * ```
 *
 * @param {string} routeName Name of the target route
 * @param {string} [verb=dynamic] HTTP verb of the sub-request. Never necessary when the
 *   target route has only one action. When omitted, the verb is selected based on the method of
 *   the parent request if the target route can handle it. Otherwise it's the first method that has
 *   been defined for the target route. This is necessary to ensure that express will actually
 *   dispatch the request to the target route. When forwarding to a route with a verb-style
 *   controller make sure to set the verb of the action handler you want to invoke.
 * @param {object} [properties={}] Request properties, like `params` and `query`
 * @param {function} next Callback
 */
exports.forward = function forwardSubRequest(routeName, verb, properties, next) {
  if (!_.isString(routeName)) {
    throw new TypeError('routeName must be a string');
  }

  if (_.isFunction(verb)) {
    next = verb;
    properties = null;
    verb = null;
  } else if (!_.isString(verb)) {
    next = properties;
    properties = verb;
    verb = null;
  }

  if (_.isFunction(properties)) {
    next = properties;
    properties = null;
  }

  if (!_.isFunction(next)) {
    throw new TypeError('next must be a callback function');
  }

  var props = properties || {};

  var res = this.res,
    currentReq = this,
    currentRoute = currentReq.routicornRoute,
    router = this.routicorn,
    invokeActionDirectly = false;

  var targetRoute = router.getRoute(routeName),
    dispatchRoute = targetRoute;

  if (!targetRoute) {
    thr('Cannot forward to unknown route: %s', routeName);
  }

  if (!targetRoute.actionable) {
    thr('Cannot forward to non-action route: %s', routeName);
  }

  if (currentRoute === targetRoute && !targetRoute.verbStyle) {
    thr('Cannot forward to same route with only one action handler: %s', routeName);
  }

  // Determine sub-request HTTP method
  verb = props.method = (verb || props.method || currentReq.method).toLowerCase();
  if (!targetRoute.handlesMethod(verb)) {
    if (targetRoute.methods.length === 1) {
      props.method = targetRoute.method;
    } else {
      thr('Cannot forward to route %s: route cannot handle method %s', routeName, verb.toUpperCase());
    }
  }

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

  // Set params and query
  props.params = props.params || currentReq.params || {};
  props.query = props.query || currentReq.query || {};

  // Determine optimal dispatch route
  if (currentRoute.isSiblingOf(targetRoute)) {
    invokeActionDirectly = true;
  } else {
    var connectingRoute = currentRoute.findConnectingRoute(targetRoute);
    if (!connectingRoute) {
      thr(
        'Unable to determine dispatch route for dispatching sub-request to route: %s. ' +
        'Probably routes haven\'t been mounted correctly.',
        targetRoute.name
      );
    }
    var parentRoutes = targetRoute.getParentRoutes(connectingRoute);
    // Skip the connecting route itself as its middleware already saw the original request
    if (parentRoutes.length < 2) {
      invokeActionDirectly = true;
    } else {
      dispatchRoute = parentRoutes[1];
    }
  }

  // Generate path
  // @todo Refactor path generation and consolidate all functionality in a new class
  var segments = targetRoute.generatePath(props.params, props.query, true, true),
    stopAtRoute = invokeActionDirectly ? dispatchRoute.getParentRoute() : dispatchRoute,
    stop = false,
    tempUrl = _(segments.slice(2)).reverse().value()
      .filter(function (item) {
        return !(stop || (stop = item[1] === stopAtRoute));
      })
      .reduce(function (memo, item) {
        return item[0] + memo;
      }, '')
      .replace(/\/+/g, '/');
  props.url = '/' + _.trim(tempUrl, '/') + segments[1];
  props.originalUrl = segments[0];

  // Create sub-request
  debug('[forward] Generate sub-request: %s %s', props.method.toUpperCase(), props.originalUrl);
  props.app = this.app;
  props.res = res;
  var dispatchReq = utils.createSubRequest(
    currentReq,
    props,
    router.request,
    expressRequestProto
  );
  res.req = dispatchReq;

  // Dispatch the request in another execution frame
  setImmediate(function () {
    debug(
      '[forward] %s: %s',
      invokeActionDirectly
        ? 'Directly dispatching sub-request to action on route'
        : 'Dispatching sub-request via ' + dispatchRoute.name + ' to route',
      targetRoute.name
    );

    dispatchRoute.invoke(dispatchReq, res, function (err) {
      dispatchReq._teardownSubRequest();
      res.req = currentReq;
      next(err);
    });
  });
};

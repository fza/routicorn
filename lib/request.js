'use strict';

var _ = require('lodash'),
  utils = require('./utils'),
  debug = require('debug')('routicorn:request'),
  thr = require('throw');

/**
 * Generate a path for a named route
 *
 * Options:
 * - mixinReqParams: {boolean} [true] Whether to mixin all properties of the original request
 * params into the params object that the route action is invoked with. Explicitly passed params
 * override request params.
 * - checkRequirements: {boolean} {true} Validate the supplied parameters
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
 * @param {object} [options] Options
 *
 * @returns {string}
 */
exports.generatePath = function generatePath(routeName, params, options) {
  options = options || {};

  if (options.mixinReqParams !== false) {
    params = _.extend({}, this.params || {}, params || {});
  }

  return this.routicorn.generatePath(routeName, params, options.checkRequirements !== false);
};


/**
 * Dispatch a sub-request based on the current request to a named route
 *
 * Almost all properties of the original request object are maintained, besides:
 * - `url`: Replaced by a generated path according to the target route.
 * - `originalUrl`: Replaced by a generated, absolute path as if the request would have come in
 * as usual.
 * - `method`: Replaced by the given verb or a dynamically chosen one, depending on the target
 * route. See 'verb' argument.
 * - Any special express properties.
 * - Low-level properties managed by http.IncomingMessage, like `headers` etc.
 *
 * If you define `params`, `query` or `body` objects in the properties hash, those will not be
 * merged with the according hashes of the original request. You will have to merge them
 * yourself, as the logic behind this is often very custom. Note that the `params` are also
 * used for path generation, so `forward()` will throw if mandatory params are not available.
 *
 * The mock request behaves almost exactly like a natural request object. Please [report]() any
 * problems you may encounter.
 *
 * The forwarding logic always tries to directly invoke the route action, which is not always
 * possible. Depending on your routing setup, sub-requests may be dispatched at the root route
 * or other segments. That is to ensure that all middleware, that would normally be called by
 * express, has seen either the original request or the sub-request. This works by comparing
 * the nearest ancestor of the current route and the target route.
 *
 * It is possible to forward a request multiple times, although this is discouraged. You really
 * shouldn't just forward your requests, but handle them as early as you can.
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
 *   target route has only one action. When omitted and the target route can handle the same
 *   HTTP method as the original request, this one will be used. Otherwise the first method
 *   that has been defined for the target route will be selected. This is necessary to ensure
 *   that express will actually dispatch the request to the target route. When forwarding to a
 *   route with a verb-style controller that handles multiple methods, it is important to set
 *   the verb if the intention is to invoke an action for a different verb than the original
 *   request's verb or when the controller cannot handle that verb.
 * @param {object} [properties={}] Properties that replace those of the original request
 * @param {function} next Callback
 */
exports.forward = function forwardSubRequest(routeName, verb, properties, next) {
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

  var props = properties || {};

  var res = this.res,
    originalReq = this,
    router = this.routicorn,
    currentRoute = originalReq.routicornRoute,
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
  verb = props.method = (verb || props.method || originalReq.method).toLowerCase();
  if (!targetRoute.handlesMethod(verb)) {
    if (targetRoute.methods.length === 1) {
      props.method = targetRoute.method;
    } else {
      thr('Cannot forward to route %s: route cannot handle method %s', routeName, verb.toUpperCase());
    }
  }

  // Check request history and detect loops
  var history = originalReq._routicornForwardHistory;
  if (history) {
    if (history.indexOf(targetRoute) !== -1) {
      thr('[forward] Detected loop: %s', _.map(history, function (r) {
        return r.name;
      }).concat([targetRoute.name]).join(' → '));
    }

    history.push(targetRoute);
  }
  props._routicornForwardHistory = history || [currentRoute, targetRoute];

  // Set params, query and body
  props.params = props.params || originalReq.params || {};
  props.query = props.query || originalReq.query || {};
  props.body = props.body || originalReq.body || {};

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
  props.requestDepth = ~~originalReq.requestDepth + 1;
  props.originalReq = originalReq;
  props.res = res;
  var dispatchReq = utils.createRequest(originalReq, props);
  debug('[forward] Generate sub-request: %s %s', dispatchReq.method, dispatchReq.originalUrl);
  res.req = dispatchReq;

  // Enhance the dispatch request with Routicorn helpers
  var origProto = dispatchReq.__proto__;
  dispatchReq.__proto__ = router.request;
  dispatchReq.__proto__.__proto = origProto;

  setImmediate(function () {
    debug(
      '[forward] %s: %s',
      invokeActionDirectly
        ? 'Directly dispatching sub-request to action on route'
        : 'Dispatching sub-request via ' + dispatchRoute.name + ' to route',
      targetRoute.name
    );

    dispatchRoute.invoke(dispatchReq, res, function (err) {
      res.req = originalReq;
      next(err);
    });
  });
};

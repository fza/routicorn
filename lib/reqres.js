'use strict';

var _ = require('lodash'),
  expressRequestProto = require('express').request,
  MockReq = require('mock-req'),
  debug = require('debug')('routicorn:route-helper'),
  thr = require('throw');

/**
 * Create a new request object
 *
 * @param {object} originalReq
 * @param {object} options
 *
 * @returns {object}
 */
function createRequest(originalReq, options) {
  options = options || {};

  var props = options.props || {};

  var reservedProps = [
    'app',
    'body',
    'files',
    'res',
    'trailers',
    'rawTrailers',
    'headers',
    'rawHeaders',
    'httpVersion',
    'httpVersionMajor',
    'httpVersionMinor',
    'connection',
    'client',
    'socket'
  ];

  reservedProps.forEach(function (prop) {
    props[prop] = originalReq[prop];
  });

  props.method = (options.props.method || originalReq.method).toUpperCase();
  props.url = options.props.url || originalReq.url;
  props.params = options.params || originalReq.params || {};

  var req = new MockReq(props);

  // @todo handle case when we should pipe the original request into the new request
  req.end();

  // Mixin express request extensions
  var protoKey, descr;
  for (protoKey in expressRequestProto) {
    if (!expressRequestProto.hasOwnProperty(protoKey)) {
      continue;
    }

    if ((descr = Object.getOwnPropertyDescriptor(expressRequestProto, protoKey))) {
      Object.defineProperty(req, protoKey, descr);
    }
  }

  Object.defineProperty(req, 'isSubRequest', {
    configurable: false,
    value: true
  });

  req.routicornSubRequest = true;

  return req;
}

module.exports = {

  /**
   * @alias http.IncomingMessage
   */
  req: {

    /**
     * Generate a path for a named route
     *
     * Options:
     * - mixinReqParams: {boolean} [false] Whether to mixin all properties of the original request
     * params into the params object that the route action is invoked with. Explicitly passed params
     * override request params.
     * - checkRequirements: {boolean} {true} Validate the supplied parameters
     *
     * Usage examples:
     *
     * ```javascript
     * req.generatePath('my-route);
     * req.generatePath('my-route', {params: {my_param: 'foo'}});
     * req.generatePath('my-route', {my_param: 'foo'}, {mixinReqParams: true});
     * ```
     *
     * @param {string} routeName Route name
     * @param {object} [params={}] Params to use for path generation
     * @param {object} [options] Options
     *
     * @returns {string}
     */
    generatePath: function (routeName, params, options) {
      var router = this.router, req = this.req;

      if (arguments.length === 3) {
        options = options || {};
        options.params = params || {};
      } else {
        options = params || {};
        options.params = options.params || {};
      }

      if (options.mixinReqParams) {
        options.params = _.merge(options.params, req.params || {});
      }

      return router.generatePath(routeName, options.params, options.checkRequirements !== false);
    },

    /**
     * Dispatch a sub-request
     *
     * Options (all truly optional):
     * - keepUrl: {boolean} [false] Whether to keep the request url, which will by default be
     * generated according to the route to forward to and the supplied params. The URL is never
     * kept when the route action cannot be invoked directly.
     * - params: {object} [{}] Params to use for route generation
     * - checkRequirements: {boolean} {true} Validate the supplied routing parameters
     * - props: {object} [{}] Additional properties to add to the mock request.
     *
     * When the options argument is omitted, all params and properties of the current request are
     * mixed in the sub-request.
     *
     * The forwarding logic always tries to directly invoke the route action, which is only
     * possible if the target route is mounted on the same level as the current route, i.e. the
     * routes are siblings. Otherwise, the sub-request is dispatched at the router's top level,
     * which will trigger all middleware that has been defined with `routicornRoute.use(...)`.
     *
     * During the lifetime of a request, it can be forwarded multiple times. To prevent loops, it
     * is verified whether the target route has already been seen and in this case fail early.
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
     *   request's verb or when the controller cannot handle that verb. In the latter case,
     *   forwarding will fail early.
     * @param {object} [options={}] Options
     * @param {function} [next] Callback
     */
    forward: function (routeName, verb, options, next) {
      if (_.isFunction(verb)) {
        next = verb;
        options = null;
        verb = null;
      } else if (_.isFunction(options)) {
        next = options;
        options = verb;
        verb = null;
      }

      options = _.defaults(options || {}, {
        keepUrl: false,
        checkRequirements: true,
        params: {},
        props: {}
      });

      verb = options.props.method = (verb || options.method || options.props.method || this.res.req.method).toLowerCase();

      /**
       * @type ActionRoute|BaseRoute
       */
      var targetRoute = this.router.getRoute(routeName);

      if (!targetRoute) {
        thr('Cannot forward to unknown route: %s', routeName);
      }

      if (!targetRoute.actionable) {
        thr('Cannot forward to non-action route: %s', routeName);
      }

      var res = this.res,
        originalReq = res.req,
        router = this.router,
        currentRoute = originalReq.routicornRoute,
        invokeActionDirectly = false;

      // Check request history
      var history = originalReq.routicornForwardHistory || [originalReq.routicornRoute];
      if (history.indexOf(targetRoute) !== -1) {
        var chain = _.map(history, function (r) {
          return r.name;
        });

        chain.push(targetRoute.name);

        thr('[forward] Detected loop: %s', chain.join(' → '));
      }
      history.push(targetRoute);
      options.props.routicornForwardHistory = history;

      // Check/correct verb if target route can't handle the passed/detected verb
      if (currentRoute === targetRoute && !targetRoute.isVerbStyle) {
        thr('Cannot forward to current route: %s', routeName);
      }

      if (!targetRoute.canHandleMethod(verb)) {
        if (targetRoute.methods.length === 1) {
          options.props.method = targetRoute.method;
        } else {
          thr('Cannot forward to route %s: route cannot handle method %s', routeName, verb.toUpperCase());
        }
      }

      // Set params
      options.params = options.params || originalReq.params || {};

      // Handle URL
      options.props.url = originalReq.url;
      if (!options.keepUrl) {
        options.props.url = targetRoute.generatePath(options.params, options.checkRequirements !== false);
      }

      // Create and dispatch request
      var dispatchReq = createRequest(originalReq, options);
      debug('[forward] Generate sub-request: %s %s', dispatchReq.method, dispatchReq.url);
      dispatchReq.originalReq = originalReq;
      res.req = dispatchReq;

      if (currentRoute.isSiblingOf(targetRoute)) {
        invokeActionDirectly = true;
      }

      function done(err) {
        // Restore original request
        delete originalReq.routicornForwardHistory;
        res.req = originalReq;

        next(err);
      }

      debug(
        '[forward] %s: %s',
        invokeActionDirectly ? 'Directly calling action on route' : 'dispatching request to route',
        targetRoute.name
      );

      setImmediate(function () {
        if (invokeActionDirectly) {
          targetRoute.invoke(dispatchReq, res, done, true);
        } else {
          router.middleware()(dispatchReq, res, done);
        }
      });
    }

  },

  /**
   * @alias http.ServerResponse
   */
  res: {

    /**
     * Redirect to a named route
     *
     * @param {number} [status] Status code
     * @param {string} routeName Route name
     * @param {object} [params={}] Params used to generate the path
     * @param {object} [queryParams={}] Query parameters
     * @param {boolean} [checkRequirements=true] Validate the supplied parameters
     */
    redirectRoute: function (status, routeName, params, queryParams, checkRequirements) {
      if (_.isString(status)) {
        checkRequirements = queryParams;
        queryParams = params;
        params = routeName;
        routeName = status;
        status = null;
      }

      if (_.isBoolean((queryParams))) {
        checkRequirements = queryParams;
        queryParams = null;
      }

      if (_.isBoolean(params)) {
        checkRequirements = params;
        params = null;
        queryParams = null;
      }

      var location = this.router.generatePath(routeName, params, queryParams, checkRequirements);

      if (status) {
        this.res.redirect(status, location);
      } else {
        this.res.redirect(location);
      }
    }

  }
};

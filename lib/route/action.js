'use strict';

var _ = require('lodash'),
  qs = require('qs'),
  inherits = require('util').inherits,
  httpVerbs = require('methods'),
  BaseRoute = require('./base'),
  debug = require('debug')('routicorn:route'),
  thr = require('throw');

/**
 * Route that handles requests by calling action methods on controllers
 *
 * @inheritdoc
 * @constructor
 * @extends BaseRoute
 */
function ActionRoute(routeName, pattern, options) {
  var self = this;

  BaseRoute.apply(self, arguments);
  this._setActionable();

  var verbStyle = false,
    methods = options.methods || ['get'],
    controller = options.controller,
    actionName = options.actionName,
    actions = self._actions = [],
    handler,
    catchAllHandler;

  function makeHandler(method) {
    var fn = self._invokeAction.bind(self, controller[method].bind(controller));
    fn.methodName = JSON.stringify(method);

    return fn;
  }

  switch (!!actionName) {
    // Direct action
    case true:
      if (!controller[actionName] || !_.isFunction(controller[actionName])) {
        thr('Cannot create route %s: Controller is missing method %s', routeName, actionName);
      }

      if (_.isString(methods)) {
        methods = [methods];
      }

      methods = methods.map(function (method) {
        return method.toLowerCase();
      });

      handler = makeHandler(actionName);

      if (methods.indexOf('all') !== -1) {
        catchAllHandler = handler;
      } else {
        methods.forEach(function (method) {
          actions.push([method, handler]);
        });
      }
      break;

    // Verb-style controller
    case false:
      verbStyle = true;
      var verbLength = 0;

      var makeVerbHandler = function (verb) {
        verbLength++;
        return makeHandler(verb);
      };

      _.keys(controller, function (verb) {
        verb = verb.toLowerCase();

        if (verb === 'all') {
          catchAllHandler = makeVerbHandler(verb);
        } else {
          // Ignore non-verb-like method names
          if (httpVerbs.indexOf(verb) === -1) {
            return;
          }

          methods.push(verb);
          handler = makeVerbHandler(verb);
          actions.push([verb, handler]);
        }
      });

      if (verbLength === 0) {
        thr('Verb-style controller for route %s does not define any HTTP verbs', routeName);
      }
  }

  if (catchAllHandler) {
    actions.push(['all', catchAllHandler]);
    methods.push('all');
  }

  this._verbActions = _.object(actions);

  Object.defineProperties(self, {
    /**
     * All HTTP methods this route can handle. If the meta-method 'all' was specified in the route
     * config, this will be the only value in the `methods` array.
     * @memberof ActionRoute#
     * @type {string[]}
     * @readonly
     */
    methods: {
      configurable: false,
      value: _.clone(methods)
    },

    /**
     * First or lone defined HTTP verb
     * @memberof ActionRoute#
     * @type {object}
     * @readonly
     */
    method: {
      configurable: false,
      value: methods[0]
    },

    /**
     * Controller this route is bound to
     * @memberof ActionRoute#
     * @type {object} controller
     * @readonly
     */
    controller: {
      configurable: false,
      value: controller
    },

    /**
     * Whether this route is connected to a verb-style router
     * @memberof ActionRoute#
     * @type {boolean}
     * @readonly
     */
    isVerbStyle: {
      configurable: false,
      value: verbStyle
    },

    /**
     * Whether this route catches all methods
     * @memberof ActionRoute#
     * @type {boolean}
     * @readonly
     */
    catchesAllMethods: {
      configurable: false,
      value: !!catchAllHandler
    }
  });
}

inherits(ActionRoute, BaseRoute);

_.extend(ActionRoute.prototype, {

  /**
   * @inheritdoc
   *
   * @param {object} req Request
   * @param {object} res Response
   * @param {function} next Callback
   * @param {boolean} [invokeDirectly] Invoke the action directly
   */
  invoke: function (req, res, next, invokeDirectly) {
    debug('Invoking %s', this.name);

    if (invokeDirectly) {
      var verb = req.method.toLowerCase();

      var handler = this._actions.length > 1 ? this._verbActions[verb] : null;
      handler = handler || this._actions[0][1];

      return handler(req, res, next);
    }

    this.getParentRoute().invoke(req, res, next);
  },

  /**
   * @inheritdoc
   */
  mount: function (expressRouter) {
    var self = this;

    this.emit('beforeMount', expressRouter);

    // Use a dedicated express router when there is middleware or an express router has already
    // been created (possibly due to #param() usage). Otherwise directly mount on the express
    // router of the parent route.
    var actualExpressRouter = expressRouter;
    if (self._middleware.length > 0 || self._expressRouter) {
      debug('Using dedicated express router to mount: %s', self.name);
      actualExpressRouter = self._getExpressRouter();
      expressRouter.use(actualExpressRouter);

      self._middleware.forEach(function (middleware) {
        if (middleware[0]) {
          actualExpressRouter.use(middleware[0], middleware[1]);
        } else {
          actualExpressRouter.use(middleware[1]);
        }
      });
    }

    _.each(this._actions, function (actionHandler) {
      debug(
        'Mounting route %s (controller method %s): %s %s',
        self.name,
        actionHandler[1].methodName,
        actionHandler[0].toUpperCase(),
        self.pattern
      );

      actualExpressRouter[actionHandler[0]](self.pattern, actionHandler[1]);
    });

    this._mounted = true;

    this.emit('mount', expressRouter);
  },

  /**
   * Determine if this route can handle a given HTTP method
   *
   * @param {string} verb HTTP method
   *
   * @returns {boolean}
   */
  canHandleMethod: function (verb) {
    return this.catchesAllMethods || !!this._verbActions[verb.toLowerCase()];
  },

  /**
   * @inheritdoc
   */
  generatePath: function (params, queryParams, checkRequirements) {
    var self = this;

    if (_.isBoolean(params)) {
      checkRequirements = params;
      queryParams = {};
      params = {};
    } else if (_.isBoolean(queryParams)) {
      checkRequirements = queryParams;
      queryParams = {};
    }

    params = params || {};
    queryParams = queryParams || {};
    checkRequirements = checkRequirements !== false;

    var route = self, segments = [];
    while (route) {
      if (_.isRegExp(route.pattern)) {
        thr(
          'Cannot generate path of a true RegExp pattern for route: %s. Route chain: %s',
          route.name,
          self._getRouteChain()
        );
      }

      segments.unshift(route._parsedPattern.segments.reduce(function (memo, segment) {
        if (!segment.isParam) {
          return memo + '/' + segment.cleanValue;
        }

        var val = params[segment.param],
          useDefault = false;

        if (!val) {
          if (!segment.defaultValue) {
            if (segment.optional) {
              return memo;
            }

            thr(
              'Cannot generate path for route %s: missing param "%s". Route chain: %s',
              route.name,
              segment.param,
              self._getRouteChain()
            );
          }

          val = segment.defaultValue;
          useDefault = true;
        }

        if (checkRequirements && segment.regExp && !segment.regExp.test(val)) {
          thr(
            'Cannot generate path for route %s: Value "%s"%s does not pass requirement for param "%s". Route chain: %s',
            route.name,
            val,
            useDefault ? ' (=default)' : '',
            segment.param,
            self._getRouteChain()
          );
        }

        return memo + '/' + val;
      }, ''));

      route = route.getParentRoute();
    }

    var queryString = qs.stringify(queryParams);
    if (queryString) {
      queryString = '?' + queryString;
    }

    var result = '/' + _.trim(segments.join('').replace(/\/+/g, '/'), '/') + queryString;

    debug('Generate path to route %s: %s', this.name, result);

    return result;
  },

  /**
   * @inheritdoc
   */
  _invokeAction: function (fn, req, res, next) {
    var self = this;

    this.emit('request', req);

    this._handleRequestParams(req, res, function (err) {
      if (err) {
        return next(err);
      }

      req.routicornRoute = self;

      setImmediate(function () {
        debug('%s: %s %s', self.name, req.method, req.originalUrl || req.url);

        fn(req, res, next);
      });
    });
  }

});

module.exports = ActionRoute;

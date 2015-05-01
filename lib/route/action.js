'use strict';

var _ = require('lodash'),
  inherits = require('util').inherits,
  httpVerbs = require('methods'),
  BaseRoute = require('./base'),
  debug = require('debug')('routicorn:route'),
  thr = require('throw');

/**
 * Route that handles requests by calling action methods on controllers
 *
 * Events:
 * - `request`: Emitted when a request is about to be handled. Arguments: req
 *
 * @inheritdoc
 * @constructor
 * @extends BaseRoute
 */
function ActionRoute(routeName, pattern, options) {
  var self = this;

  if (!(self instanceof ActionRoute)) {
    return new ActionRoute(routeName, pattern, options);
  }

  BaseRoute.apply(self, arguments);
  self._setActionable();

  this._handleRequestParamsOnAction = false;

  var verbStyle = false,
    verbs = [],
    methods = options.methods || ['get'],
    controller = options.controller,
    actionName = options.actionName,
    actions = self._actions = [],
    handler,
    catchAllHandler;

  function makeHandler(method) {
    var fn = function routeActionHandler(req, res, next) {
      self._invokeAction(controller[method].bind(controller), req, res, next);
    };

    fn.methodName = options.controllerName + '.' + method;

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

      methods = methods.map(function (verb) {
        return verb.toLowerCase();
      });

      handler = makeHandler(actionName);

      if (methods.indexOf('all') !== -1) {
        catchAllHandler = handler;
      } else {
        methods.forEach(function (verb) {
          verbs.push(verb);
          actions.push([verb, handler]);
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

          verbs.push(verb);
          actions.push([verb, makeVerbHandler(verb)]);
        }
      });

      if (verbLength === 0) {
        thr('The verb-style controller for route %s does not define any HTTP verbs', routeName);
      }
  }

  if (catchAllHandler) {
    verbs.push('all');
    actions.push(['all', catchAllHandler]);
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
      value: _.clone(verbs)
    },

    /**
     * First or lone defined HTTP verb
     * @memberof ActionRoute#
     * @type {object}
     * @readonly
     */
    method: {
      configurable: false,
      value: verbs[0]
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
    verbStyle: {
      configurable: false,
      value: verbStyle
    },

    /**
     * Whether this route catches all methods
     * @memberof ActionRoute#
     * @type {boolean}
     * @readonly
     */
    handlesAllMethods: {
      configurable: false,
      value: !!catchAllHandler
    }
  });
}

inherits(ActionRoute, BaseRoute);

_.extend(ActionRoute.prototype, {

  /**
   * @inheritdoc
   */
  invoke: function (req, res, next) {
    debug('Invoking route: %s', this.name);
    req.routicornRoute = this;

    if (this._handleRequestParamsOnAction) {
      return this._callHandler(req, res, next);
    }

    this._getExpressRouter()(req, res, next);
  },

  /**
   * @inheritdoc
   */
  mount: function (expressRouter) {
    var self = this;

    this.emit('beforeMount');

    // Use a dedicated express router when there is middleware or an express router has already
    // been created (possibly due to #param() usage). Otherwise directly mount on the express
    // router of the parent route.
    if (self.getAllMiddleware().length > 0 || self._expressRouter) {
      var parentExpressRouter = expressRouter;
      expressRouter = self._getExpressRouter();
      parentExpressRouter.use(expressRouter);
      expressRouter.use(function handleRequestParams(req, res, next) {
        self._handleRequestParams(req, res, next);
      });
      self._mountMiddleware();
    } else {
      // Handle request params directly before calling the action. There's no necessity to
      // create a separate middleware stack just for params handling.
      this._handleRequestParamsOnAction = true;
    }

    _.each(this._actions, function (actionHandler) {
      debug(
        'Mounting route %s: %s %s with action %s',
        self.name,
        actionHandler[0].toUpperCase(),
        self.pattern,
        actionHandler[1].methodName
      );

      expressRouter[actionHandler[0]](self.pattern, actionHandler[1]);
    });

    this._mounted = true;

    this.emit('mount');
  },

  /**
   * Determine if this route can handle a given HTTP method
   *
   * @param {string} verb HTTP method
   *
   * @returns {boolean}
   */
  handlesMethod: function (verb) {
    return this.handlesAllMethods || !!this._verbActions[verb.toLowerCase()];
  },

  /**
   * Directly call the action handler that matches the request best. Does not invoke any middleware
   * despite the params handler.
   *
   * @param {object} req Request
   * @param {object} res Response
   * @param {function} next Callback
   */
  _callHandler: function (req, res, next) {
    var handler = this._actions.length > 1 ? this._verbActions[req.method.toLowerCase()] : null;
    handler = handler || this._actions[0][1];
    handler(req, res, next);
  },

  /**
   * Action handler
   *
   * @param {function} fn Controller action method to call
   * @param {object} req Request
   * @param {object} res Response
   * @param {function} next Callback
   */
  _invokeAction: function (fn, req, res, next) {
    var self = this;

    this.emit('request', req);

    req.routicornRoute = self;

    var doInvoke = setImmediate.bind(null, function () {
      debug('Call %s: %s %s', self.name, req.method, req.originalUrl || req.url);

      try {
        fn(req, res, next);
      } catch (e) {
        next(e);
      }
    });

    if (self._handleRequestParamsOnAction) {
      this._handleRequestParams(req, res, function (err) {
        if (err) {
          return next(err);
        }

        doInvoke();
      });
    } else {
      doInvoke();
    }
  }

});

module.exports = ActionRoute;

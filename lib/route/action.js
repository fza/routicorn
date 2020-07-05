'use strict';

var _ = require('lodash');
var debug = require('debug')('routicorn:route:action');
var thr = require('format-throw');
var inherits = require('util').inherits;
var httpVerbs = require('methods');
var BaseRoute = require('./base');
var utils = require('../utils');

/**
 * @inheritdoc
 * @constructor
 * @extends BaseRoute
 * @private
 */
function ActionRoute(routeName, pattern, parentRoute, options) {
  if (!(this instanceof ActionRoute)) {
    return new ActionRoute(routeName, pattern, parentRoute, options);
  }

  var self = this;

  BaseRoute.apply(this, arguments);

  var verbs = []; // All actions in the order they should be tried
  var actions = {}; // Verb -> controller.methodName map
  var controller = options.controller;
  var actionName = options.actionName;
  var catchAll = false;

  function registerAction(verb, methodName) {
    if (verb === 'all') {
      catchAll = true;
    } else {
      verbs.push(verb);
    }

    actions[verb] = methodName;
  }

  switch (!!actionName) {
    // Direct action, one controller method handles one or more HTTP verbs
    case true:
      var methods = _([options.methods] || ['get'], true)
        .flatten(true)
        .compact()
        .map(function (verb) {
          return verb.toLowerCase();
        })
        .unique()
        .value();

      if (!controller[actionName] || !_.isFunction(controller[actionName])) {
        thr('Cannot create route %s: Controller is missing method %s', this.name, actionName);
      }

      if (methods.indexOf('all') !== -1) {
        methods = ['all'];
        catchAll = true;
      }

      methods.forEach(function (verb) {
        registerAction(verb, actionName);
      });
      break;

    // Verb-style controller, iterate over all controller methods and search for methods named
    // after HTTP verbs
    case false:
      Object.keys(controller).forEach(function (methodName) {
        // All verb-style actions must be lowercase
        if (methodName.toLowerCase() !== methodName || !_.isFunction(controller[methodName])) {
          return;
        }

        if (methodName === 'all' || httpVerbs.indexOf(methodName) !== -1) {
          registerAction(methodName, methodName);
        }
      });

      if (verbs.length === 0) {
        thr('The verb-style controller for route %s does not define any HTTP verbs', this.name);
      }
  }

  if (catchAll) {
    verbs.push('all');
  }

  verbs.forEach(function (verb) {
    self._expressRouter[verb]('/', function routeActionHandler(req, res, next) {
      self._invokeAction(actions[verb], req, res, next);
    });
  });

  // Public properties
  utils.defineProps(this, true, {
    /**
     * All HTTP verbs this route can handle. If the meta-method 'all' was specified in the route
     * config, this will be the only value in the `methods` array.
     * @memberof ActionRoute#
     * @type {string[]}
     * @readonly
     */
    verbs: verbs,

    /**
     * First or lone defined HTTP verb
     * @memberof ActionRoute#
     * @type {object}
     * @readonly
     */
    verb: verbs[0],

    /**
     * Controller this route is bound to
     * @memberof ActionRoute#
     * @type {object} controller
     * @readonly
     */
    controller: controller,

    /**
     * Name of the controller as defined in route config
     * @memberof ActionRoute#
     * @type {object} controller
     * @readonly
     */
    controllerName: options.controllerName,

    /**
     * Whether this route is connected to a verb-style router
     * @memberof ActionRoute#
     * @type {boolean}
     * @readonly
     */
    verbStyle: !actionName,

    /**
     * Whether this route catches all methods
     * @memberof ActionRoute#
     * @type {boolean}
     * @readonly
     */
    handlesAllMethods: catchAll
  });
}

inherits(ActionRoute, BaseRoute);

/**
 * Determine if this route can handle a given HTTP method
 *
 * @param {string} verb HTTP method
 *
 * @returns {boolean}
 */
ActionRoute.prototype.handlesMethod = function (verb) {
  return this.handlesAllMethods || this.verbs.indexOf(verb.toLowerCase()) !== -1;
};

/**
 * Action handler
 *
 * @private
 *
 * @param {string} methodName Name of the controller method to invoke
 * @param {object} req Request
 * @param {object} res Response
 * @param {function} next Callback
 */
ActionRoute.prototype._invokeAction = function (methodName, req, res, next) {
  debug('Call %s: %s %s', this.name, req.method, req.originalUrl || req.url);

  // Mixin extra params
  var extraParams = req._routicornExtraParams;
  _.extend(req.params, extraParams[extraParams.length - 1] || {});

  try {
    this.controller[methodName](req, res, next);
  } catch (e) {
    next(e);
  }
};

module.exports = ActionRoute;

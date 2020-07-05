'use strict';

var _ = require('lodash');
var debug = require('debug')('routicorn:controller-factory');
var thr = require('format-throw');
var path = require('path');
var utils = require('./utils');

/**
 * @constant {string} DEFAULT_CONTROLLER_BASE_PATH
 */
var DEFAULT_BASE_PATH = 'app/controllers';

/**
 * Controller factory
 *
 * @constructor
 * @private
 * @param {string} [basePath="app/controllers"] Controller base path
 */
function ControllerFactory(basePath) {
  // Private properties
  utils.defineProps(this, false, {
    /**
     * @memberof ControllerFactory#
     * @name _basePath
     * @type {string}
     * @private
     * @readonly
     */
    basePath: basePath || DEFAULT_BASE_PATH,

    /**
     * @memberof ControllerFactory#
     * @name _cache
     * @type {object.<string, object>}
     * @private
     * @readonly
     */
    cache: {}
  });
}

/**
 * Get a controller either from cache, otherwise load (and instanciate) it.
 *
 * @param {string} script
 * @returns {object}
 */
ControllerFactory.prototype.getController = function (script) {
  script = this._sanitizePath(script);

  return this._cache[script] || (this._cache[script] = this._createController(script));
};

/**
 * Sanitize a controller path
 *
 * @private
 * @param {string} script
 * @returns {string}
 */
ControllerFactory.prototype._sanitizePath = function (script) {
  return path
    .relative(this._basePath, path.normalize(path.join(this._basePath, script)))
    .replace(/\.js$/, '');
};

/**
 * Create a new controller instance
 *
 * @private
 * @param {string} script
 * @returns {object}
 */
ControllerFactory.prototype._createController = function (script) {
  debug('Create controller instance: %s', script);

  var Controller = require(path.join(this._basePath, script));

  var obj = Controller;

  // Treat functions as constructors
  if (_.isFunction(Controller)) {
    obj = new Controller();
  }

  if (typeof obj !== 'object') {
    thr('Cannot create a controller that is neither a constructor nor an object: %s', script);
  }

  return obj;
};

module.exports = ControllerFactory;

'use strict';

var _ = require('lodash'),
  ReadableStream = require('stream').Readable,
  util = require('util'),
  thr = require('throw');

/**
 * Mock request (readable stream only)
 *
 * @constructor
 *
 * @param {string} method HTTP method
 * @param {url} url URL
 * @param {object} props Properties
 */
function MockRequest(method, url, props) {
  var self = this;

  if (!(self instanceof MockRequest)) {
    return new MockRequest(method, url, props);
  }

  _.extend(self, props);

  ReadableStream.call(self);

  self.url = url || '/';
  self.method = method.toUpperCase() || 'GET';
  self.headers = {};
  self.rawHeaders = [];

  if (props.headers) {
    _.keys(props.headers).forEach(function (key) {
      var val = props.headers[key];
      if (val !== undefined) {
        val += ''; // Ensure string
        self.headers[key.toLowerCase()] = val;
        self.rawHeaders.push(key);
        self.rawHeaders.push(val);
      }
    });
  }
}

util.inherits(MockRequest, ReadableStream);

MockRequest.prototype._read = function () {
  thr('Method not implemented: MockRequest#_read');
};

module.exports = MockRequest;

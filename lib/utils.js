'use strict';

var expressRequestProto = require('express').request,
  MockReq = require('mock-req');

exports.createRequest = function createRequest(originalReq, props) {
  props = props || {};

  // Properties that must not be overridden
  var reservedProps = [
    'app',
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

  props.method = (props.method || originalReq.method).toUpperCase();
  props.url = props.url || originalReq.url;
  props.params = props.params || originalReq.params || {};
  props.query = props.query || originalReq.query || {};
  props.body = props.body || originalReq.body || {};

  var req = new MockReq(props);

  // @todo handle case when we should pipe the original request body
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

  Object.defineProperties(req, {
    isSubRequest: {
      configurable: false,
      value: true
    },
    routicornSubRequest: {
      configurable: true,
      value: true
    }
  });

  return req;
};

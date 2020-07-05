'use strict';

var http = require('http');
var path = require('path');
var express = require('express');
var routicorn = require('..');

var app = express();

var router = routicorn({
  controllerBasePath: path.join(__dirname, 'controllers')
});

var jsonBodyParser = require('body-parser').json();

router.instance.on('route registered', function (route) {
  if (route.handlesMethod('post')) {
    route.use(jsonBodyParser);
  }
});

router.instance.loadRoutes(path.join(__dirname, 'routing', 'main.yml'));

console.log(router.instance.getRouteTree());

app.use(router);

var server = http.createServer(app);

server.listen(3000);

server.on('listening', function () {
  console.log('Server listening on port 3000');
});

'use strict';

var http = require('http'),
  path = require('path'),
  express = require('express'),
  routicorn = require('..');

var app = express();

var router = routicorn({
  controllerBasePath: path.join(__dirname, 'controllers')
});

router.on('beforeMount', function (route) {
  if (route.name === '_users') {
    route.use(require('body-parser').json());
  }
});

router.loadRoutes(path.join(__dirname, 'routing', 'main.yml'));

console.log(router.getRouteTree());

app.use(router);

var server = http.createServer(app);

server.listen(3000);

server.on('listening', function () {
  console.log('Server listening on port 3000');
});

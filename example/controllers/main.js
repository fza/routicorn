'use strict';

var http = require('http');

module.exports = {

  index: function indexAction(req, res, next) {
    res.redirect('list_users', next);
  }

};

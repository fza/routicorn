'use strict';

function UserController() {
  this.users = [];
}

UserController.prototype.list = function (req, res, next) {
  if (this.users.length === 0) {
    return res.send('No users found.');
  }

  var userLinks = this.users.map(function (username) {
    return '<a href="' + req.generatePath('user_info', {
        username: username
      }) + '">' + username + '</a>';
  });

  var userList = '<ul><li>' + userLinks.join('</li><li>') + '</li></ul>';

  res.send('Here comes the user list' + userList);
};

UserController.prototype.create = function (req, res, next) {
  var username = req.body.username;

  if (username) {
    if (this.users.indexOf(username) !== -1) {
      return res.status(409).send('User already exists.');
    }

    this.users.push(username);

    return req.forward('user_info', {
      params: {
        username: username
      }
    }, next);
    //return res.redirect('list_users');
  }

  next(new Error('Please POST a JSON document, like {"username": "foo"}'));
};

UserController.prototype.show = function (req, res, next) {
  var username = req.params.username;

  if (this.users.indexOf(username) === -1) {
    res.status(404).send('Oops. There is no such user: ' + username);
    return;
  }

  var listBooksLink = '<a href="' + req.generatePath('list_books') + '">See the books</a>';

  res.send('User: ' + username + '. ' + listBooksLink);
};

module.exports = UserController;

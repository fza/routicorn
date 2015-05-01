'use strict';

var userBooks = {};

function getUserBooks(username) {
  if (!userBooks[username]) {
    userBooks[username] = [];
  }

  return userBooks[username];
}

module.exports = {

  list: function (req, res, next) {
    var books = getUserBooks(req.params.username);

    if (books.length === 0) {
      res.send('No books found.');
      return;
    }

    var bookList = '<ul><li>' + books.join('</li><li>') + '</li></ul>';

    res.send('Here comes the list of books' + bookList);
  },

  create: function (req, res, next) {
    var books = getUserBooks(req.params.username);

    var bookslug = req.body.bookslug;

    if (books.indexOf(bookslug) !== -1) {
      res.status(409).send('Book already exists.');
      return;
    }

    books.push(bookslug);

    res.redirect('list_books');
  },

  show: function (req, res, next) {
    var books = getUserBooks(req.params.username);

    var bookslug = req.params.bookslug;

    if (books.indexOf(bookslug) === -1) {
      res.status(404).send('Oops. There is no such book: ' + bookslug);
      return;
    }

    res.send('Here comes the book: ' + bookslug);
  },

  remove: function (req, res, next) {
    var books = getUserBooks(req.params.username);

    books.splice(books.indexOf(req.params.bookslug), 1);

    req.forward('list_books', req, res, next);
  }

};

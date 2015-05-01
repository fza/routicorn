# Routicorn

> Advanced express routing with superpowers

This is a [Booticorn]() component, but can be used standalone, too.

@todo Write what this actually is...

## Features

@todo

## Installation

```
npm install --save routicorn
```

## Usage

@todo

## Example

See the example folder for a tiny demonstration of Routicorn:

```shell
node example/app.js
```

## API

API docs are available in the [Wiki]().

```javascript
var Routicorn = require('routicorn');

var router = new Routicorn({/* options */});

router.loadRoutes('main.yml');
router.generatePath(routeName, params)
req.generatePath(routerName, params);
req.forward(routeName, options);
res.redirectRoute(routeName, params);

app.use(router);
```

## Contributing

In lieu of a formal styleguide, take care to maintain the existing coding style. Add unit tests for any new or changed functionality. Lint and test your code using `grunt test`.

## License

Copyright (c) 2015 [Felix Zandanel](http://felix.zandanel.me)  
Licensed under the MIT license.

See LICENSE for more info.


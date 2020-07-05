# Routicorn

[![Build Status](https://travis-ci.org/fza/routicorn.svg)](https://travis-ci.org/fza/routicorn) [![Coverage Status](https://coveralls.io/repos/fza/routicorn/badge.svg?branch=master)](https://coveralls.io/r/fza/routicorn?branch=master) [![Dependency Status](https://david-dm.org/fza/routicorn.svg)](https://david-dm.org/fza/routicorn) [![devDependency Status](https://david-dm.org/fza/routicorn/dev-status.svg)](https://david-dm.org/fza/routicorn#info=devDependencies)

[![NPM](https://nodei.co/npm/routicorn.png)](https://npmjs.org/package/routicorn)

> Advanced YAML-based routing for express

## Features

@todo

## Installation

```
npm install --save express routicorn
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


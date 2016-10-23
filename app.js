'use strict';

const SwaggerExpress = require('swagger-express-mw');
const SwaggerUi = require('swagger-tools/middleware/swagger-ui');
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

const uuid = require('node-uuid');

const consul = require('consul')( {
    host: process.env.CONSUL || '127.0.0.1',
    promisify: true
});

app.use(bodyParser.json({limit: '50mb'}));
app.use(cookieParser());

var config = {
    appRoot: __dirname, // required config
    swaggerSecurityHandlers: {
        Oauth: (req, authOrSecDef, scopesOrApiKey, cb) => {
            if (scopesOrApiKey == "open") {
                cb();
            }else {
                cb();
            }
        }
    }
};

consul.kv.get('config/sentinel/hikvision', function(err, result) {
    if (err) throw err;

    let config = JSON.parse(result.Value);

    global.hikvision = require('./hikvision.js')(config);
});

SwaggerExpress.create(config, function (err, swaggerExpress) {
    if (err) {
        throw err;
    }

    app.use(SwaggerUi(swaggerExpress.runner.swagger));
    // install middleware
    swaggerExpress.register(app);

    var port = process.env.PORT || 5000;
    var server = app.listen(port, () => {

        let host = require('ip').address();
        let port = server.address().port;

        var module = {
            id: uuid.v4(),
            name: 'sentinel_hikvision',
            server: host,
            port: port/*,
            check:{
                http: `http://${host}:${port}/health`,
                interval:'15s'
            }*/
        };

        consul.agent.service.register(module)
            .then( (err, result) =>{
                if (err)
                    throw err;
            })
            .catch( (err) => {
                throw err;
            })
    });

    if (swaggerExpress.runner.swagger.paths['/health']) {
        console.log(`you can get /health on port ${port}`);
    }

});

module.exports = app;
require('array.prototype.find');

var http = require('http');
var uuid = require('node-uuid');
var NodeCache = require( "node-cache" );
var statusCache = new NodeCache();

var express = require('express');
var app = express();

var Etcd = require('node-etcd');
var etcd = new Etcd(process.env.ETCD || '127.0.0.1');

var router = express.Router();

var httpServer = http.createServer(app);

var wsClients = [];

var expressWs = require('express-ws')(app, httpServer);

var moduleName = 'hikvision';

function sendAll(value){
    for (var  i in wsClients ) {
        wsClients[i].send(JSON.stringify(value));
    }
}

var result = etcd.getSync('sentinel/config/' + moduleName + '/');

var config = JSON.parse(result.body.node.value);

var service = require('./' + moduleName)(
    config,
    function(device){
        var value = {
            "message" : "new-device",
            "device" : device
        };
        sendAll(value);
    },
    function(id, status){
        var value = {
            "message" : "status-update",
            "device" : moduleName + '.' + id,
            "value" : status
        };
        sendAll(value);
    }
);


require('portfinder').getPort(function (err, port) {

    httpServer.listen(port, process.env.HOSTNAME || '127.0.0.1', function () {

        var module = {
            "name": moduleName,
            "enabled": true,
            "endpoint": {
                "protocol": "http",
                "server": this.address().address,
                "port": this.address().port
            }
        };

        etcd.del('sentinel/modules/' + module.name );
        etcd.set('sentinel/modules/' + module.name, JSON.stringify(module));

        console.log('Plugin Server Listening on %s:%d', this.address().address, this.address().port);

    });
});



//etcd.mkdirSync('sentinel/modules/');


app.use(express.static(__dirname + '/html'));

app.use('/', router);

app.ws('/', function(ws, req) {
    ws['id'] =  uuid.v4();
    wsClients.push( ws );

    ws.on('message', function(msg) {
    });
    ws.on('close', function() {
        var removeIndex = -1;
        for (var i in wsClients ) {
            if ( this.id === wsClients[i].id ) {
                removeIndex = i;
                break;
            }
        }

        if ( removeIndex != -1)
            wsClients.splice(removeIndex, 1);
    });
});

statusCache.on( "set", function( key, value ){
    sendAll(value);
});

for (var endPointUrl in service.endPoints) {
    var fn = service.endPoints[ endPointUrl ];

    function endPointHandler(name, fn){
        return function(req, res) {
            //var f = endPoints[ req.path ];
            console.log( name + ' called' );
            try{
                var parameters = [];

                var v = null;

                if ( Object.keys(req.params).length != 0 ){
                    v = req.params;
                }

                if ( Object.keys(req.query).length != 0 ){
                    if ( v == null )
                        v = {};
                    Object.keys(req.query).forEach(function (key) {
                        v[key] = req.query[key];
                    });
                }

                if ( v == undefined )
                    v = {};

                parameters.push( v );

                parameters.push( function(data){
                    if ( data.type !== undefined){
                        res.type(data.type);
                        res.send(new Buffer(data.image, 'binary'));
                        res.status(200).end();
                    }else {
                        res.status(200).json({'result': 'ok', 'data': data});
                    }
                });

                parameters.push( function(data){
                    res.status(400).json( { 'result' : 'failed', 'data' : data });
                });

                fn.apply(this,parameters);
            }catch(e){
                res.status(500).json({"error": e} );
            }
        };
    };

    var handler = new endPointHandler(endPointUrl, fn);

    var apiUrl = '/' + endPointUrl;

    console.log('added http path %s', apiUrl);

    router.get( apiUrl, handler );
}

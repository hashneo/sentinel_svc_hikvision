require('array.prototype.find');

module.exports = function (config, onDevice, onStatus) {

	var request = require('request');
	//var config = require('./config.json');

    var xml2js = require('xml2js');

	var NodeCache = require( "node-cache" );
	var deviceCache = new NodeCache();
	var statusCache = new NodeCache();

    var forAllAsync = exports.forAllAsync || require('forallasync').forAllAsync;

    var http = require('http');
    var keepAliveAgent = new http.Agent({ keepAlive: true });

    var gm = require('gm').subClass({imageMagick: true});

	var that = this;

	deviceCache.on( "set", function( key, value ){
		if ( onDevice !== undefined )
			onDevice(value);
	});

	statusCache.on( "set", function( key, value ){
		if ( onStatus !== undefined )
			onStatus(key, value);
	});

    function loadSmartSetting(camera, setting, complete){
        var url = setting;
        switch (setting){
            case 'ROI':
            case 'AudioDetection':
                url += '/channels';
                break;
        }
        get(camera.baseUrl + '/Smart/' + url, function (settings, body) {
            var data = {
                'parsed': settings,
                'xml': body
            };
            complete(data);
        }, function(error){
            complete(null);
        });
    }

    function updateSmartSetting(camera, feature, enabled, success, failed){
        get(camera.baseUrl + '/Smart/' + feature, function (settings, body) {
            settings[feature + 'List'][feature][0]['enabled'][0] = enabled ? 'true' : 'false';
            post(camera.baseUrl + '/Smart/' + feature, settings, function (result, body) {
                success();
            }, function(error){
                failed(error);
            });
        }, function(error){
            failed(error);
        });
    }
    function loadSmartCapabilities(camera, complete){
        get(camera.baseUrl + '/Smart/capabilities', function (capabilities) {
            camera['capabilities'] = {};
            for( var cap in capabilities.SmartCap ){
                var match;
                if ((match = (/isSupport(\w+)/gi).exec(cap)) != null ){
                    var feature = match[1];
                    if ( capabilities.SmartCap[cap][0] === "true" ) {
                        camera['capabilities'][feature] = {};
                    }
                }
            }
            complete();
        }, function(error){
            console.log( error );
            complete();
        });
    }

    function get(url, success, error) {
        call( 'GET', null, url, success, error );
    }

    function post(url, obj, success, error) {

        var builder = new xml2js.Builder();
        var xml = builder.buildObject(obj);

        call( 'PUT', xml, url, success, error );
    }

	function call(method, body, url, success, error) {

/*
        http.request( { hostname:'localhost', port:80, path:'/', agent:pool});
        request({url:"http://www.google.com", pool:pool });
*/
		var options = {
            method: method,
			url : url,
            encoding: null,
			timeout : 30000,
            agent: keepAliveAgent
		};

        if ( body ) {
            options['body'] = body;
            options['contentType'] = 'application/xml';
        }

        //console.log( 'calling url => ' + url );

        try {
            request(options, function (err, response, body) {
                if (!err && response.statusCode == 200) {

                    if ( response.headers['content-type'].toLowerCase().indexOf('image/') != -1 ){
                        success( { 'type' : response.headers['content-type'], 'image' : body } );
                    } else {
                        var v = null;
                        try {
                            xml2js.parseString(body, function (err, result) {
                                success(result, body);
                            });
                        }
                        catch(e) {
                            error(e.message);
                        }
                    }
                } else {
					console.log("request failed => " + err);
                    error(err || body.toString('utf8')  );
                }
            });
        }catch(e){
            console.log("request error => " + e);
            error(e);
        }
	}

	function getCamera(id){
        for(var i in config.cameras){
            var camera = config.cameras[i];
            if ( camera.data.id === id ){
                return camera;
            }
        }
        throw 'invalid camera id => ' + id;
    }

	this.device = new function () {
		this.get = new function () {
			this.status = function (params, success) {
				var output = {};
				output['Status'] = statusCache.get(params.id);
				success(output);
			};
            this.image = function (params, success, failed) {
                var camera = getCamera( params.id );

                get(camera.baseUrl + '/Streaming/channels/1/picture', function (data) {

                    var contentType = data.type;

                    if ( params.width !== undefined || params.height !== undefined ){
                        var match = (/(\w+)\/(\w+)(?:;\s+charset)*/gi).exec(contentType);
                        if (!match)
                            return failed('unknown content type => ' + contentType);

                        var currentStatus = statusCache.get(params.id);

                        var imageType = match[2];
                        var buffer = data.image;
                        var newWidth = params.width;
                        var newHeight = params.height;

                        var image = gm(buffer);

                        image.size(function (err, size) {

                            if (err) return failed(err);

                            if (newHeight === undefined)
                                newHeight = ( size.height / size.width ) * newWidth;
                            if ( newWidth === undefined )
                                newWidth = ( size.width / size.height ) * newHeight;

                            if ( currentStatus !== undefined && currentStatus.LineDetection !== undefined && currentStatus.LineDetection.enabled ) {
                                for (var i in currentStatus.LineDetection.lines) {
                                    var line = currentStatus.LineDetection.lines[i];

                                    var s = {x: Math.round(line[0].x*size.width), y: Math.round(line[0].y*size.height)}; // Start
                                    var e = {x: Math.round(line[1].x*size.width), y: Math.round(line[1].y*size.height)}; // End

                                    image
                                        .stroke('#FF000080', 20)
                                        .drawLine(s.x, s.y, e.x, e.y);

                                }
                            }
/*
                            if ( currentStatus !== undefined && currentStatus.FieldDetection !== undefined && currentStatus.FieldDetection.enabled ) {
                                for (var a in currentStatus.FieldDetection.regions) {
                                    var region = currentStatus.FieldDetection.regions[i];

                                    var points = [];

                                    for (var b in region) {
                                        var xy = region[b];

                                        points.push({
                                            'x': Math.round(xy.x * size.width),
                                            'y': Math.round(xy.y * size.height)
                                        });
                                    }

                                    image
                                        .stroke('#FF000080', 20)
                                        .drawPolyline(points);
                                }
                            }
 */
                            image
                                .resize(newWidth, newHeight)
                                .toBuffer(imageType,function (err, buffer) {
                                    if (err) return failed(err);
                                    return success({ 'type' : 'image/' + imageType, 'image' : buffer });
                                });

                        });
/*

                        lwip.open(buffer, imageType, function(err, image){
                            if ( err ) return failed(err.message);
                            if (newHeight === undefined)
                                newHeight = ( image.height() / image.width() ) * newWidth;
                            if ( newWidth === undefined )
                                newWidth = ( image.width() / image.height() ) * newHeight;

                            var batch = image.batch();

                            batch.resize(parseInt(newWidth), parseInt(newHeight));

                            batch.exec(function(err, image){
                                if ( err ) return failed(err.message);
                                image.toBuffer(imageType, function(err, buffer){
                                    if ( err ) return failed(err.message);
                                    return success({ 'type' : 'image/' + imageType, 'image' : buffer });
                                })
                            });

                        });
*/
                        //failed();
                    }else{
                        success(data);
                    }

                }, function(error){
                    failed();
                });
            };
            this.stream = function (params, success, failed) {

            };
		};

		this.set = new function () {
            this.alarm = new function () {
                this.enable = function (params, success, failed) {
                    var camera = getCamera( params.id );
                    updateSmartSetting(camera, params.type, true, success, failed);
                };
                this.disable = function (params, success, failed) {
                    var camera = getCamera( params.id );
                    updateSmartSetting(camera, params.type, false, success, failed);
                };

            };
		};
	};

	this.status = function (params, success, error) {

        function refreshCameraStatus( complete, camera ){
            if ( Object.keys(camera['capabilities']).length > 0 ) {
                var k = Object.keys(camera['capabilities']);
                var results = {};
                forAllAsync(k, function (complete, setting) {
                    loadSmartSetting(camera, setting, function(data){
                        results[setting] = data;
                        complete();
                    });
                }, 1)
                    .then(function () {
                        var currentStatus = {};
                        try {
                            for (var key in results) {
                                switch (key) {
                                    case 'LineDetection':
                                        if (currentStatus[key] === undefined) currentStatus[key] = {};
                                        var result = results[key]['parsed'][key + 'List'][key][0];

                                        currentStatus[key]['enabled'] = Boolean(result.enabled[0] === 'true');

                                        var _x = parseInt(result.normalizedScreenSize[0].normalizedScreenWidth[0]);
                                        var _y = parseInt(result.normalizedScreenSize[0].normalizedScreenHeight[0]);

                                        currentStatus[key]['lines'] = [];

                                        for (var a in result.LineItemList) {
                                            var line = result.LineItemList[a].LineItem[0];

                                            var newLine = [];
                                            for (b in line.CoordinatesList) {
                                                var lineCoordinates = line.CoordinatesList[b].Coordinates;
                                                for (var c in lineCoordinates) {
                                                    var xy = lineCoordinates[c];
                                                    var x = parseInt(xy.positionX[0]);
                                                    var y = parseInt(xy.positionY[0]);

                                                    newLine.push({'x': x / _x, 'y': 1 - (y / _y)});
                                                }
                                            }

                                            currentStatus[key]['lines'].push(newLine);
                                        }
                                        break;
                                    case 'FieldDetection':
                                        if (currentStatus[key] === undefined) currentStatus[key] = {};
                                        currentStatus[key]['enabled'] = Boolean(results[key]['parsed'][key + 'List'][key][0]['enabled'][0] === 'true');

                                        var result = results[key]['parsed'][key + 'List'][key][0];

                                        var _x = parseInt(result.normalizedScreenSize[0].normalizedScreenWidth[0]);
                                        var _y = parseInt(result.normalizedScreenSize[0].normalizedScreenHeight[0]);

                                        currentStatus[key]['regions'] = [];

                                        for (var a in result.FieldDetectionRegionList) {
                                            var region = result.FieldDetectionRegionList[a].FieldDetectionRegion[0];

                                            var newRegion = [];
                                            for (b in region.RegionCoordinatesList) {
                                                var regionCoordinates = region.RegionCoordinatesList[b].RegionCoordinates;
                                                for (var c in regionCoordinates) {
                                                    var xy = regionCoordinates[c];
                                                    var x = parseInt(xy.positionX[0]);
                                                    var y = parseInt(xy.positionY[0]);

                                                    newRegion.push({'x': x / _x, 'y': 1 - (y / _y)});
                                                }
                                            }

                                            currentStatus[key]['regions'].push(newRegion);
                                        }
                                        break;
                                }
                            }
                            statusCache.set(camera.data.id, currentStatus);
                        }
                        catch(e){
                            console.trace(e);
                        }
                        complete();
                    });
            } else {
                complete();
            }
        }

        forAllAsync( config.cameras, refreshCameraStatus, 10 )
        .then(function () {
            success();
        });
	};

	this.system = function (params, success, error) {
        console.log("Loading System");

        var devices = [];

        function loadCamera( complete, camera, i ) {
            camera['baseUrl'] = 'http://' + camera.user + ':' + camera.password + '@' + camera.address + '/ISAPI';

            get(camera.baseUrl + '/System/deviceInfo', function (info) {

                var d = {};

                d['name'] = info.DeviceInfo.deviceName[0];
                d['id'] = info.DeviceInfo.deviceID[0];
                d['where'] = { 'location' : info.DeviceInfo.deviceLocation[0] };
                d['type'] = 'ip.camera';
                d['current'] = {};

                deviceCache.set(d['id'], d);

                devices.push(d);

                camera.data = d;

                loadSmartCapabilities( camera, function(){
                    complete();
                });

            }, function(error){
                complete();
            });
        }

        forAllAsync( config.cameras, loadCamera, 10 ).then(function () {
            console.log('loaded all cameras');
            success(devices)
        });

    };

	this.endPoints = {
		"system": this.system,
		"status": this.status,
		"device/:id/status": this.device.get.status,
		"camera/:id/alarm/enable": this.device.set.alarm.enable,
		"camera/:id/alarm/disable": this.device.set.alarm.disable,
		"camera/:id/image": this.device.get.image,
        "camera/:id/stream": this.device.get.stream,
	};

	this.system( {}, function() {

		function updateStatus() {

			that.status({}, function (status) {

				setTimeout(updateStatus, 5000);

			}, function(e){
                console.log("status returned error => " + e);
				setTimeout(updateStatus, 5000);
			});

		}

		setTimeout(updateStatus, 1000);
	});

	return this;
}


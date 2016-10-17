'use strict';

require('array.prototype.find');

function hikvision(config) {

    if ( !(this instanceof hikvision) ){
        return new hikvision(config);
    }

    const redis = require('redis');

    const pub = redis.createClient({ host: '10.0.1.10' });

    const request = require('request');

    const xml2js = require('xml2js');

    const NodeCache = require( 'node-cache' );

    const deviceCache = new NodeCache();
    const statusCache = new NodeCache();

    const forAllAsync = exports.forAllAsync || require('forallasync').forAllAsync;

    const http = require('http');
    const keepAliveAgent = new http.Agent({ keepAlive: true });

    const gm = require('gm').subClass({imageMagick: true});


    deviceCache.on( 'set', ( key, value ) => {
        pub.publish('hikvision.device.insert',  JSON.stringify( { id : key, value : value } ) );
    });

    statusCache.on( 'set', ( key, value ) => {
        pub.publish('hikvision.device.update',  JSON.stringify( { id : key, value : value } ) );
    });

    function call(method, body, url) {

        return new Promise( (fulfill, reject) => {

            var options = {
                method: method,
                url: url,
                encoding: null,
                timeout: 30000,
                agent: keepAliveAgent
            };

            if (body) {
                options['body'] = body;
                options['contentType'] = 'application/xml';
            }

            try {
                request(options, function (err, response, body) {
                    if (!err && response.statusCode == 200) {

                        if (response.headers['content-type'].toLowerCase().indexOf('image/') != -1) {
                            fulfill({'type': response.headers['content-type'], 'image': body});
                        } else {
                            try {
                                xml2js.parseString(body, (err, result) => {
                                    fulfill(result, body);
                                });
                            }
                            catch (e) {
                                reject(e.message);
                            }
                        }
                    } else {
                        console.log('request failed => ' + err);
                        reject(err || body.toString('utf8'));
                    }
                });
            } catch (e) {
                console.log('request error => ' + e);
                reject(e);
            }
        });
    }

    function get(url) {
        return call( 'GET', null, url );
    }

    function post(url, obj) {

        var builder = new xml2js.Builder();
        var xml = builder.buildObject(obj);

        return call( 'PUT', xml, url );
    }


    function loadSmartSetting(camera, setting){

        return new Promise( (fulfill, reject) => {

            var url = setting;
            switch (setting) {
                case 'ROI':
                case 'AudioDetection':
                    url += '/channels';
                    break;
            }

            get(camera.baseUrl + '/Smart/' + url)
                .then( (settings, body) => {
                    var data = {
                        'parsed': settings,
                        'xml': body
                    };
                    fulfill(data);
                })
                .catch( (err) => {
                    reject(err);
                })
        });
    }

    function updateSmartSetting(camera, feature, enabled) {

        return new Promise( (fulfill, reject) => {

            get(camera.baseUrl + '/Smart/' + feature)

                .then ( (settings) => {
                    settings[feature + 'List'][feature][0]['enabled'][0] = enabled ? 'true' : 'false';
                    return post(camera.baseUrl + '/Smart/' + feature, settings);
                })
                .then( (result) => {
                    fulfill(result);
                })
                .catch( (err) =>{
                    reject(err);
                });
        });

    };

    function loadSmartCapabilities(camera){

        return new Promise( (fulfill, reject) => {
            get(camera.baseUrl + '/Smart/capabilities')

                .then((capabilities) => {
                    camera['capabilities'] = {};
                    for (var cap in capabilities.SmartCap) {
                        var match;
                        if ((match = (/isSupport(\w+)/gi).exec(cap)) != null) {
                            var feature = match[1];
                            if (capabilities.SmartCap[cap][0] === 'true') {
                                camera['capabilities'][feature] = {};
                            }
                        }
                    }
                    fulfill();
                })
                .catch( (err) => {
                    reject(err);
                });
        });
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

    this.getDevices = () => {

        return new Promise( (fulfill, reject) => {
            deviceCache.keys( ( err, ids ) => {
                if (err)
                    return reject(err);

                deviceCache.mget( ids, (err,values) =>{
                    if (err)
                        return reject(err);

                    var data = [];

                    for (var key in values) {
                        data.push(values[key]);
                    }

                    fulfill(data);
                });
            });
        });

    };

    this.getDeviceStatus = (id) => {

        return new Promise( (fulfill, reject) => {
            try {
                statusCache.get(id, (err, value) => {
                    if (err)
                        return reject(err);

                    fulfill(value);
                }, true);
            }catch(err){
                reject(err);
            }
        });

    };

    this.setLineDetection = (id, enabled) => {
        return updateSmartSetting( getCamera( id ), 'LineDetection', enabled);
    };

    this.setFieldDetection = (id, enabled) => {
        return updateSmartSetting( getCamera( id ), 'FieldDetection', enabled);
    };

    this.getImage = (id, width, height) => {

        return new Promise( (fulfill, reject) => {

            var camera = getCamera(id);

            get(camera.baseUrl + '/Streaming/channels/1/picture')
                .then((data) => {

                    var contentType = data.type;

                    var match = (/(\w+)\/(\w+)(?:;\s+charset)*/gi).exec(contentType);
                    if (!match)
                        return reject('unknown content type => ' + contentType);

                    var imageType = match[2];

                    var buffer = data.image;
                    var image = gm(buffer);

                    function scaleImage(image, width, height) {
                        return new Promise((fulfill, reject) => {

                            if (width !== undefined || height !== undefined) {

                                var newWidth = width;
                                var newHeight = height;

                                image.size((err, size) => {

                                    if (err)
                                        return reject(err);

                                    if (newHeight === undefined)
                                        newHeight = ( size.height / size.width ) * newWidth;
                                    if (newWidth === undefined)
                                        newWidth = ( size.width / size.height ) * newHeight;

                                    image.resize(newWidth, newHeight)
                                    fulfill(image);
                                });
                            }else {
                                fulfill(image);
                            }
                        })
                    };

                    scaleImage( image, width, height )
                        .then( (image) => {
                            return new Promise( (fulfill, reject) => {
                                var currentStatus = statusCache.get(id);

                                if (currentStatus !== undefined ) {

                                    if (currentStatus.LineDetection !== undefined && currentStatus.LineDetection.enabled) {
                                        for (var i in currentStatus.LineDetection.lines) {
                                            var line = currentStatus.LineDetection.lines[i];

                                            var s = {
                                                x: Math.round(line[0].x * size.width),
                                                y: Math.round(line[0].y * size.height)
                                            }; // Start
                                            var e = {
                                                x: Math.round(line[1].x * size.width),
                                                y: Math.round(line[1].y * size.height)
                                            }; // End

                                            image
                                                .stroke('#FF000080', 20)
                                                .drawLine(s.x, s.y, e.x, e.y);
                                        }
                                    }
                                }

                                fulfill(image);
                            })
                        })
                        .then( (image) => {
                            image.toBuffer(imageType, (err, buffer) => {
                                if (err)
                                    return reject(err);

                                return fulfill({'type': 'image/' + imageType, 'image': buffer});
                            });
                        })
                        .catch( (err) => {
                            reject(err);
                        });
                })
                .catch( (err) => {
                    reject(err);
                });
        });
    };

    function refreshCamerasStatus () {

        function refreshCameraStatus(compvare, camera) {
            if (Object.keys(camera['capabilities']).length > 0) {
                var k = Object.keys(camera['capabilities']);
                var results = {};

                forAllAsync(k, (compvare, setting) => {
                    loadSmartSetting(camera, setting)
                        .then( (data) => {
                            results[setting] = data;
                            compvare();
                        });
                }, 1)
                    .then( () => {
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
                                            for (var b in line.CoordinatesList) {
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
                                            for (var b in region.RegionCoordinatesList) {
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
                        catch (e) {
                            console.trace(e);
                        }
                        compvare();
                    });
            } else {
                compvare();
            }
        }

        forAllAsync(config.cameras, refreshCameraStatus, 10)
            .then(function () {
                return;
            });
    };

    function loadCameras () {
        console.log('Loading System');

        return new Promise( (fulfill, reject) => {

            var devices = [];

            function loadCamera(compvare, camera) {

                camera['baseUrl'] = 'http://' + camera.user + ':' + camera.password + '@' + camera.address + '/ISAPI';

                get(camera.baseUrl + '/System/deviceInfo')
                    .then((info) => {

                        var d = {};

                        d['name'] = info.DeviceInfo.deviceName[0];
                        d['id'] = info.DeviceInfo.deviceID[0];
                        d['where'] = {'location': info.DeviceInfo.deviceLocation[0]};
                        d['type'] = 'ip.camera';
                        d['current'] = {};

                        deviceCache.set(d['id'], d);

                        devices.push(d);

                        camera.data = d;

                        loadSmartCapabilities(camera)
                            .then(() => {
                                compvare();
                            });
                    })
                    .catch((err)=>{
                        reject(err);
                    })
            }

            forAllAsync(config.cameras, loadCamera, 10).then(function () {
                console.log('loaded all cameras');
                fulfill(devices);
            });

        });
    };

    loadCameras()
        .then( (devices) => {
            setInterval(refreshCamerasStatus, 5000);
        });


}

module.exports = hikvision;
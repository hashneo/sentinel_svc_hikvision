'use strict';

require('array.prototype.find');

function hikvision(config) {

    if ( !(this instanceof hikvision) ){
        return new hikvision(config);
    }

    const redis = require('redis');

    let pub = redis.createClient(
        {
            host: process.env.REDIS || global.config.redis || '127.0.0.1' ,
            socket_keepalive: true,
            retry_unfulfilled_commands: true
        }
    );

    pub.on('end', function(e){
        console.log('Redis hung up, committing suicide');
        process.exit(1);
    });

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
        pub.publish('sentinel.device.insert',  JSON.stringify( { module: 'hikvision', id : key, value : value } ) );
    });

    statusCache.on( 'set', ( key, value ) => {
        pub.publish('sentinel.device.update',  JSON.stringify( { module: 'hikvision', id : key, value : value } ) );
    });

    function call(method, body, url) {

        return new Promise( (fulfill, reject) => {

            let options = {
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

        let builder = new xml2js.Builder();
        let xml = builder.buildObject(obj);

        return call( 'PUT', xml, url );
    }


    function loadSmartSetting(camera, setting){

        return new Promise( (fulfill, reject) => {

            let url = setting;
            switch (setting) {
                case 'ROI':
                case 'AudioDetection':
                    url += '/channels';
                    break;
            }

            get(camera.baseUrl + '/Smart/' + url)
                .then( (settings, body) => {
                    let data = {
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
                    for (let cap in capabilities.SmartCap) {
                        let match;
                        if ((match = (/isSupport(\w+)/gi).exec(cap)) != null) {
                            let feature = match[1];
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
        for(let i in config.cameras){
            let camera = config.cameras[i];
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

                    statusCache.mget( ids, (err, statuses) => {
                        if (err)
                            return reject(err);

                        let data = [];

                        for (let key in values) {
                            let v = values[key];

                            if ( statuses[key] ) {
                                v.current = statuses[key];
                                data.push(v);
                            }
                        }

                        fulfill(data);
                    });

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

            let camera = getCamera(id);

            get(camera.baseUrl + '/Streaming/channels/1/picture')
                .then((data) => {

                    let contentType = data.type;

                    let match = (/(\w+)\/(\w+)(?:;\s+charset)*/gi).exec(contentType);
                    if (!match)
                        return reject('unknown content type => ' + contentType);

                    let imageType = match[2];

                    let buffer = data.image;
                    let image = gm(buffer);

                    function scaleImage(image, width, height) {
                        return new Promise((fulfill, reject) => {

                            image.size((err, size) => {
                                if (err)
                                    return reject(err);

                                if (width !== undefined || height !== undefined) {

                                let newWidth = width;
                                let newHeight = height;

                                    if (newHeight === undefined)
                                        newHeight = ( size.height / size.width ) * newWidth;
                                    if (newWidth === undefined)
                                        newWidth = ( size.width / size.height ) * newHeight;

                                    image.resize(newWidth, newHeight);

                                    fulfill( {image, size: {width : newWidth, height: newHeight}});

                                }else {
                                    fulfill( {image, size} );
                                }
                            });

                        })
                    }

                    scaleImage( image, width, height )
                        .then( (i) => {
                            return new Promise( (fulfill, reject) => {
                                let currentStatus = statusCache.get(id);

                                if (currentStatus !== undefined ) {

                                    if (currentStatus.LineDetection !== undefined && currentStatus.LineDetection.enabled) {
                                        for (let x in currentStatus.LineDetection.lines) {
                                            let line = currentStatus.LineDetection.lines[x];

                                            let s = {
                                                x: Math.round(line[0].x * i.size.width),
                                                y: Math.round(line[0].y * i.size.height)
                                            }; // Start
                                            let e = {
                                                x: Math.round(line[1].x * i.size.width),
                                                y: Math.round(line[1].y * i.size.height)
                                            }; // End

                                            i.image
                                                .stroke('#FF000080', i.size.width > 1000 ? 20 : 5)
                                                .drawLine(s.x, s.y, e.x, e.y);
                                        }
                                    }
                                }

                                fulfill(i);
                            })
                        })
                        .then( (i) => {
                            i.image.toBuffer(imageType, (err, buffer) => {
                                if (err)
                                    return reject(err);

                                return fulfill({'type': 'image/' + imageType, 'image': buffer});
                            });
                        })
                        .catch( (err) => {
                            console.error(err);
                            reject(err);
                        });
                })
                .catch( (err) => {
                    console.error(err);
                    reject(err);
                });
        });
    };

    function refreshCamerasStatus () {

        function refreshCameraStatus(complete, camera) {
            if (Object.keys(camera['capabilities']).length > 0) {
                let k = Object.keys(camera['capabilities']);
                let results = {};

                forAllAsync(k, (complete, setting) => {
                    loadSmartSetting(camera, setting)
                        .then( (data) => {
                            results[setting] = data;
                            complete();
                        })
                        .catch( (err) => {
                            console.error(err);
                            complete();
                        });
                }, 1)
                    .then( () => {
                        let currentStatus = {};
                        try {
                            for (let key in results) {
                                let result;
                                let _x, _y;

                                if (!currentStatus['detection']){
                                    currentStatus['detection'] = {}
                                }

                                let status = currentStatus['detection'];

                                switch (key) {
                                    case 'LineDetection':

                                        if (!status['line'])
                                            status['line'] = {};

                                        result = results[key]['parsed'][key + 'List'][key][0];

                                        status['line']['enabled'] = Boolean(result.enabled[0] === 'true');

                                        _x = parseInt(result.normalizedScreenSize[0].normalizedScreenWidth[0]);
                                        _y = parseInt(result.normalizedScreenSize[0].normalizedScreenHeight[0]);

                                        status['line']['lines'] = [];

                                        for (let a in result.LineItemList) {
                                            let line = result.LineItemList[a].LineItem[0];

                                            let newLine = [];
                                            for (let b in line.CoordinatesList) {
                                                let lineCoordinates = line.CoordinatesList[b].Coordinates;
                                                for (let c in lineCoordinates) {
                                                    let xy = lineCoordinates[c];
                                                    let x = parseInt(xy.positionX[0]);
                                                    let y = parseInt(xy.positionY[0]);

                                                    newLine.push({'x': x / _x, 'y': 1 - (y / _y)});
                                                }
                                            }

                                            status['line']['lines'].push(newLine);
                                        }
                                        break;
                                    case 'FieldDetection':

                                        if (!status['field'])
                                            status['field'] = {};

                                        status['field']['enabled'] = Boolean(results[key]['parsed'][key + 'List'][key][0]['enabled'][0] === 'true');

                                        result = results[key]['parsed'][key + 'List'][key][0];

                                        _x = parseInt(result.normalizedScreenSize[0].normalizedScreenWidth[0]);
                                        _y = parseInt(result.normalizedScreenSize[0].normalizedScreenHeight[0]);

                                        status['field']['regions'] = [];

                                        for (let a in result.FieldDetectionRegionList) {
                                            let region = result.FieldDetectionRegionList[a].FieldDetectionRegion[0];

                                            let newRegion = [];
                                            for (let b in region.RegionCoordinatesList) {
                                                let regionCoordinates = region.RegionCoordinatesList[b].RegionCoordinates;
                                                for (let c in regionCoordinates) {
                                                    let xy = regionCoordinates[c];
                                                    let x = parseInt(xy.positionX[0]);
                                                    let y = parseInt(xy.positionY[0]);

                                                    newRegion.push({'x': x / _x, 'y': 1 - (y / _y)});
                                                }
                                            }

                                            if ( newRegion.length > 0)
                                                status['field']['regions'].push(newRegion);
                                        }
                                        break;
                                }
                            }
                            statusCache.set(camera.data.id, currentStatus);
                        }
                        catch (e) {
                            console.trace(e);
                        }
                        complete();
                    })
            } else {
                complete();
            }
        }

        forAllAsync(config.cameras, refreshCameraStatus, 10)
            .then(function () {
            });
    }

    function loadCameras () {
        console.log('Loading System');

        return new Promise( (fulfill, reject) => {

            let devices = [];

            function loadCamera(complete, camera) {

                camera['baseUrl'] = 'http://' + camera.user + ':' + camera.password + '@' + camera.address + '/ISAPI';

                get(camera.baseUrl + '/System/deviceInfo')
                    .then((info) => {

                        let d = {};

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
                                complete();
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
        })
        .catch( (err) => {
            console.error(err);
            process.exit(1);
        });

}

module.exports = hikvision;
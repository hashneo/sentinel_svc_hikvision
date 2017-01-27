'use strict';

module.exports.getDevices = (req, res) => {
    global.hikvision.getDevices()
        .then( (devices) => {
            res.json( { data: devices, result : 'ok'  } );
        })
        .catch( (err) => {
            res.status(500).json( { code: err.code || 0, message: err.message } );
        });
};

module.exports.Reload = (req, res) => {
    global.hikvision.Reload()
        .then( () => {
            res.json( { data: {}, result : 'ok'  } );
        })
        .catch( (err) => {
            res.status(500).json( { code: err.code || 0, message: err.message } );
        });
};

module.exports.getDeviceStatus = (req, res) => {
    global.hikvision.getDeviceStatus(req.swagger.params.id.value)
        .then( (status) => {
            res.json( { data: { status: status }, result : 'ok' } );
        })
        .catch( (err) => {
            res.status(500).json( { code: err.code || 0, message: err.message } );
        });
};

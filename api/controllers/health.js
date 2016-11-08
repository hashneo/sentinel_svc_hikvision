'use strict';

module.exports.health = (req, res) => {

    if (!req.swagger.params.id)
        return res.status(400).send( `missing service id. resend with /health?id=XXX` );

    let serviceId = req.swagger.params.id.value;

    if ( process.env.SERVICE_ID !== serviceId )
        return res.status(410).send( `${serviceId} no longer exists` );

    res.json({"status": "ok"});
};

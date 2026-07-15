const express = require('express');
const router = express.Router();
const controller = require('../controllers/whatsapp.controller');
const requireAuth = require('../middleware/auth');

router.use(requireAuth);

router.get('/:purpose/status', controller.getStatus);
router.post('/:purpose/connect', controller.connect);
router.post('/:purpose/logout', controller.logout);
router.post('/:purpose/refresh-qr', controller.refreshQr);
router.get('/:purpose/templates', controller.listTemplates);
router.post('/:purpose/templates', controller.createTemplate);
router.put('/templates/:id', controller.updateTemplate);
router.delete('/templates/:id', controller.removeTemplate);
router.get('/:purpose/logs', controller.listLogs);

router.post('/send-document', controller.sendDocument);
router.post('/broadcast/greeting', controller.broadcastGreeting);

module.exports = router;

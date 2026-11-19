import express from 'express';
import auth from '../../middlewares/auth';
import { Role } from '@prisma/client';
import InsightsController from './Insights.controller';

const router = express.Router();

router.get("/overview", auth(Role.USER, Role.ADMIN), InsightsController.getOverview);

router.get("/stock-runway", auth(Role.USER, Role.ADMIN), InsightsController.getStockRunway);

router.get("/due-radar", auth(Role.USER, Role.ADMIN), InsightsController.getDueRadar);

router.get("/cash-pulse", auth(Role.USER, Role.ADMIN), InsightsController.getCashPulse);

router.get("/auto-target", auth(Role.USER, Role.ADMIN), InsightsController.getAutoTarget);

const InsightsRouter = router;

export default InsightsRouter;
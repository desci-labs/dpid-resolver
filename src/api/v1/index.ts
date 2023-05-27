import { Router } from "express";
import { list } from "./list";

const router = Router();

router.get("/dpid", list);

export default router;

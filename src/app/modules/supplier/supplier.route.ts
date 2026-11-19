import express from "express";
import auth from "../../middlewares/auth";
import { Role } from "@prisma/client";
import validationRequest from "../../middlewares/validationRequest";
import SuppliersValidation from "./supplier.validation";
import SupplierController from "./supplier.controller";



const router = express.Router();


router.post("/recorded-suppliers",
    auth(Role.ADMIN, Role.USER),
    validationRequest(SuppliersValidation.createSupplierZodSchema),
    SupplierController.RecordedSuppliers
);

router.get("/get-suppliers",
    auth(Role.ADMIN, Role.USER),
    SupplierController.getSuppliers
);

router.get("/find-by-supplierId/:supplierId",
    auth(Role.ADMIN, Role.USER),
    SupplierController.findBySupplierId
);

router.patch("/update-supplier/:supplierId",
    auth(Role.ADMIN, Role.USER),
    validationRequest(SuppliersValidation.updateSupplierZodSchema),
    SupplierController.updateSupplier
);
router.delete("/delete-supplier/:supplierId",
    auth(Role.ADMIN, Role.USER),
    SupplierController.deleteSupplier
);
router.get("/dashboard", auth(Role.ADMIN, Role.USER), SupplierController.dashboardReport);
router.get("/calculate-account/:supplierId",
    auth(Role.ADMIN, Role.USER),
    SupplierController.calculateSupplierAccountBlance
)

const SupplierRoutes = router;
export default SupplierRoutes;
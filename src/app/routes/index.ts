import express from "express";
import UserRoutes from "../modules/User/user.route";
import SupplierRoutes from "../modules/supplier/supplier.route";
import ProductsRoutes from "../modules/products/products.route";
import TransactionsRoutes from "../modules/transactions/transactions.route";



const router = express.Router();

const moduleRoutes = [


  {
    path: "/user",
    route: UserRoutes
  },
  {
    path: "/supplier",
    route: SupplierRoutes
  },
  {
    path: "/product",
    route: ProductsRoutes
  },
  {
    path: "/transaction",
    route: TransactionsRoutes
  }

];

moduleRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
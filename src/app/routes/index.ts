
import express from "express"

import { AuthRoutes } from "../modules/Auth/auth.routes"
import { UserRoutes } from "../modules/User/user.routes"

const router = express.Router()

const moduleRoute = [
	
	  {
    path: '/users',
    route: UserRoutes,
  },
	  {
    path: '/auth',
    route: AuthRoutes,
  },
]
moduleRoute.forEach(route => router.use(route.path, route.route))


export default router

import express from "express"

import { AuthRoutes } from "../modules/Auth/auth.routes"
import { UserRoutes } from "../modules/User/user.routes"
import { GmbOrderRoutes } from "../modules/GmbOrder/gmbOrder.routes"
import { DomainRoutes } from "../modules/Domain/domain.routes"
import { DomainOrderRoutes } from "../modules/DomainOrder/domainOrder.routes"

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
    {
    path: '/gmb-orders',
    route: GmbOrderRoutes,
  },
    {
    path: '/domain',
    route: DomainRoutes,
  },
    {
    path: '/domain-orders',
    route: DomainOrderRoutes,
  },
]
moduleRoute.forEach(route => router.use(route.path, route.route))


export default router
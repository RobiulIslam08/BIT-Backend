
import express from "express"

import { AuthRoutes } from "../modules/Auth/auth.routes"
import { UserRoutes } from "../modules/User/user.routes"
import { GmbOrderRoutes } from "../modules/GmbOrder/gmbOrder.routes"
import { GmbProfileRoutes } from "../modules/GmbProfile/gmbProfile.routes"
import { DomainRoutes } from "../modules/Domain/domain.routes"
import { DomainOrderRoutes } from "../modules/DomainOrder/domainOrder.routes"
import { DomainAssetRoutes } from "../modules/Domain/domainAsset.routes"
import { PaymentMethodRoutes } from "../modules/PaymentMethod/paymentMethod.routes"
import { DomainPricingRoutes } from "../modules/DomainPricing/domainPricing.routes"
import { HostingPlanRoutes } from "../modules/HostingPlan/hostingPlan.routes"
import { HostingOrderRoutes } from "../modules/HostingOrder/hostingOrder.routes"
import { HostingRoutes } from "../modules/Hosting/hosting.routes"
import { WalletRoutes } from "../modules/Wallet/wallet.routes"
import { CartRoutes } from "../modules/Cart/cart.routes"
import { DigitalServiceRoutes } from "../modules/DigitalService/digitalService.routes"
import { DigitalServiceOrderRoutes } from "../modules/DigitalServiceOrder/digitalServiceOrder.routes"
import { TabbyOrderRoutes } from "../modules/TabbyOrder/tabbyOrder.routes"

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
    path: '/gmb-profiles',
    route: GmbProfileRoutes,
  },
    {
    path: '/domain',
    route: DomainRoutes,
  },
    {
    path: '/domain-orders',
    route: DomainOrderRoutes,
  },
    {
    path: '/domains',
    route: DomainAssetRoutes,
  },
    {
    path: '/payment-methods',
    route: PaymentMethodRoutes,
  },
    {
    path: '/domain-pricing',
    route: DomainPricingRoutes,
  },
    {
    path: '/hosting-plans',
    route: HostingPlanRoutes,
  },
    {
    path: '/hosting-orders',
    route: HostingOrderRoutes,
  },
    {
    path: '/hostings',
    route: HostingRoutes,
  },
    {
    path: '/wallet',
    route: WalletRoutes,
  },
    {
    path: '/cart',
    route: CartRoutes,
  },
    {
    path: '/digital-services',
    route: DigitalServiceRoutes,
  },
    {
    path: '/digital-service-orders',
    route: DigitalServiceOrderRoutes,
  },
    {
    path: '/tabby-orders',
    route: TabbyOrderRoutes,
  },
]
moduleRoute.forEach(route => router.use(route.path, route.route))


export default router

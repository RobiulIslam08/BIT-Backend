// ============================================
// BIT SOFTWARE — Digital Service Static Catalog
// ============================================
// Prices are canonical in SAR. PayPal/wallet charge USD at SAR_TO_USD_RATE.
// Keep in sync with frontend: src/constants/digitalServices.js

export const SAR_TO_USD_RATE = 3.75;

export type TDigitalServiceKey = 'supply_company_portal';
export type TDigitalPackageType = 'trial' | 'monthly' | 'yearly';

export interface IDigitalPackageDef {
  priceSAR: number;
  durationDays: number;
  oncePerUser?: boolean;
  label: string;
}

export interface IDigitalServiceDef {
  key: TDigitalServiceKey;
  name: string;
  description: string;
  landingPath: string;
  packages: Record<TDigitalPackageType, IDigitalPackageDef>;
}

export const DIGITAL_SERVICE_CATALOG: Record<TDigitalServiceKey, IDigitalServiceDef> = {
  supply_company_portal: {
    key: 'supply_company_portal',
    name: 'Supply Company Portals',
    description:
      'Inventory, ordering, and logistics management web applications for supply companies.',
    landingPath: '/services/web-development/supply-company',
    packages: {
      trial: {
        priceSAR: 58,
        durationDays: 30,
        oncePerUser: true,
        label: '1-Month Trial',
      },
      monthly: {
        priceSAR: 200,
        durationDays: 30,
        label: 'Monthly',
      },
      yearly: {
        priceSAR: 1650,
        durationDays: 365,
        label: 'Yearly',
      },
    },
  },
};

export const DIGITAL_SERVICE_KEYS = Object.keys(
  DIGITAL_SERVICE_CATALOG,
) as TDigitalServiceKey[];

export const DIGITAL_PACKAGE_TYPES: TDigitalPackageType[] = ['trial', 'monthly', 'yearly'];

export const getServiceDef = (serviceKey: string): IDigitalServiceDef => {
  const def = DIGITAL_SERVICE_CATALOG[serviceKey as TDigitalServiceKey];
  if (!def) {
    throw new Error(`Unknown digital service: ${serviceKey}`);
  }
  return def;
};

export const getPackageDef = (
  serviceKey: string,
  packageType: string,
): { service: IDigitalServiceDef; pkg: IDigitalPackageDef; packageType: TDigitalPackageType } => {
  const service = getServiceDef(serviceKey);
  if (!DIGITAL_PACKAGE_TYPES.includes(packageType as TDigitalPackageType)) {
    throw new Error(`Invalid package type: ${packageType}`);
  }
  const typed = packageType as TDigitalPackageType;
  const pkg = service.packages[typed];
  if (!pkg || !(pkg.priceSAR > 0)) {
    throw new Error(`Invalid package pricing for ${serviceKey}/${packageType}`);
  }
  return { service, pkg, packageType: typed };
};

/** Public catalog shape for API/frontend. */
export const getPublicCatalog = () =>
  DIGITAL_SERVICE_KEYS.map((key) => {
    const s = DIGITAL_SERVICE_CATALOG[key];
    return {
      key: s.key,
      name: s.name,
      description: s.description,
      landingPath: s.landingPath,
      packages: {
        trial: {
          priceSAR: s.packages.trial.priceSAR,
          durationDays: s.packages.trial.durationDays,
          oncePerUser: !!s.packages.trial.oncePerUser,
          label: s.packages.trial.label,
        },
        monthly: {
          priceSAR: s.packages.monthly.priceSAR,
          durationDays: s.packages.monthly.durationDays,
          label: s.packages.monthly.label,
        },
        yearly: {
          priceSAR: s.packages.yearly.priceSAR,
          durationDays: s.packages.yearly.durationDays,
          label: s.packages.yearly.label,
        },
      },
    };
  });

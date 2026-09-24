import React from 'react';
import { BillingView, BillingViewProps } from './BillingView';

export interface TenantBillingSummaryProps extends BillingViewProps {}

/**
 * TenantBillingSummary delegates directly to the unified industry-standard
 * BillingView dashboard.
 */
export const TenantBillingSummary: React.FC<TenantBillingSummaryProps> = (props) => {
  return <BillingView {...props} />;
};

export default TenantBillingSummary;

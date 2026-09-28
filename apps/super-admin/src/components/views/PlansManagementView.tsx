import React, { useState, useMemo } from 'react';
import {
  Users,
  RefreshCw,
  Plus,
  Pencil,
  Star,
  EyeOff,
  Eye,
  Search,
  LayoutGrid,
  List,
  HardDrive,
  Sparkles,
  CheckCircle2,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { Plan } from '../../types';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';

interface PlansManagementViewProps {
  plans: Plan[];
  loading: boolean;
  onRefresh: () => void;
  onCreatePlan: () => void;
  onEditPlan: (plan: Plan) => void;
  onToggleActive: (plan: Plan) => void;
}

export const PlansManagementView: React.FC<PlansManagementViewProps> = ({
  plans,
  loading,
  onRefresh,
  onCreatePlan,
  onEditPlan,
  onToggleActive,
}) => {
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Sorted and filtered
  const sortedPlans = useMemo(() => {
    return [...plans].sort((a, b) => a.displayOrder - b.displayOrder || a.seatCount - b.seatCount);
  }, [plans]);

  const activePlans = useMemo(() => plans.filter((p) => p.isActive), [plans]);
  const inactivePlans = useMemo(() => plans.filter((p) => !p.isActive), [plans]);
  const defaultPlan = useMemo(() => plans.find((p) => p.isDefault) || activePlans[0] || null, [plans, activePlans]);

  // Price range computation
  const activePrices = useMemo(() => {
    return activePlans.map((p) => p.monthlyPriceInPaise / 100).filter((pr) => pr > 0);
  }, [activePlans]);

  const minPrice = activePrices.length ? Math.min(...activePrices) : 0;
  const maxPrice = activePrices.length ? Math.max(...activePrices) : 0;

  const filteredPlans = useMemo(() => {
    return sortedPlans.filter((plan) => {
      if (filterStatus === 'active' && !plan.isActive) return false;
      if (filterStatus === 'inactive' && plan.isActive) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = plan.name?.toLowerCase().includes(q);
        const matchesBadge = plan.badge?.toLowerCase().includes(q);
        const matchesDesc = plan.description?.toLowerCase().includes(q);
        return matchesName || matchesBadge || matchesDesc;
      }
      return true;
    });
  }, [sortedPlans, filterStatus, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Top Header & Action Controls */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Plans &amp; Seat Tiers</h1>
            <p className="text-xs text-slate-500">
              Configure subscription tiers, seat capacities, and customer pricing for self-service domain onboarding.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {/* View Mode Toggle */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Dense Table View"
              >
                <List size={14} />
                <span className="hidden sm:inline">Table</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
                  viewMode === 'cards'
                    ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Customer Preview Cards View"
              >
                <LayoutGrid size={14} />
                <span className="hidden sm:inline">Cards</span>
              </button>
            </div>

            <Button
              size="sm"
              variant="secondary"
              onClick={onRefresh}
              disabled={loading}
              title="Refresh pricing plans"
              className="min-h-[38px] px-3 rounded-lg"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              <span className="hidden sm:inline ml-1.5">Refresh</span>
            </Button>

            <Button
              size="sm"
              variant="primary"
              onClick={onCreatePlan}
              icon={<Plus className="w-4 h-4" />}
              className="min-h-[38px] px-3.5 rounded-lg"
            >
              New Plan
            </Button>
          </div>
        </div>

        {/* Catalog KPI Summary Ribbon */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mt-5">
          <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Live on Checkout</span>
            <div className="text-xl font-bold text-slate-900 mt-1 flex items-baseline gap-1.5">
              <span>{activePlans.length}</span>
              <span className="text-xs font-normal text-slate-400">/ {plans.length} tiers</span>
            </div>
            <div className="text-[11px] text-emerald-600 font-medium mt-1 flex items-center gap-1">
              <CheckCircle2 size={12} />
              <span>Visible to customers</span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Default Tier</span>
            <div className="text-xl font-bold text-slate-900 mt-1 truncate">
              {defaultPlan ? defaultPlan.name : 'None selected'}
            </div>
            <div className="text-[11px] text-amber-600 font-medium mt-1 flex items-center gap-1">
              <Star size={12} className="fill-amber-500 text-amber-500" />
              <span>Pre-selected on signup</span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Pricing Range</span>
            <div className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
              {minPrice > 0 ? `₹${minPrice} - ₹${maxPrice}` : 'Custom / Free'}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Per mailbox / month</div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Draft / Inactive</span>
            <div className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
              {inactivePlans.length}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">Hidden from wizard</div>
          </div>
        </div>

        {/* Filter Tabs & Search Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-6 pt-5 border-t border-slate-100">
          <div className="flex overflow-x-auto no-scrollbar bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs gap-1 max-w-full">
            <button
              type="button"
              onClick={() => setFilterStatus('all')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                filterStatus === 'all'
                  ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>All Plans</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 font-semibold">
                {plans.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilterStatus('active')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                filterStatus === 'active'
                  ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CheckCircle2 size={13} className="text-emerald-500" />
              <span>Active in Checkout</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                {activePlans.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilterStatus('inactive')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                filterStatus === 'inactive'
                  ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Draft &amp; Inactive</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 font-semibold">
                {inactivePlans.length}
              </span>
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search plans by name, tier, or badge..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600 min-h-[38px] bg-white shadow-xs"
            />
          </div>
        </div>
      </section>

      {/* Main Content Area: Table View or Cards View */}
      {loading && plans.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500 text-xs">
          Loading subscription tiers...
        </div>
      ) : filteredPlans.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <Layers size={36} className="mx-auto mb-3 text-slate-300" />
          <div className="text-sm font-semibold text-slate-800 mb-1">
            {searchQuery ? 'No Plans Found' : 'No Plans Configured'}
          </div>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {searchQuery
              ? `No subscription plans match "${searchQuery}".`
              : 'No plans exist under this filter. Click "New Plan" to create one.'}
          </p>
        </div>
      ) : viewMode === 'table' ? (
        /* ========================================================================= */
        /* MODE A: SLEEK MODERN DATA TABLE                                           */
        /* ========================================================================= */
        <div className="data-table-container bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tier Name</th>
                <th>Capacity &amp; Quota</th>
                <th>Pricing</th>
                <th>Display Order</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlans.map((plan) => {
                const priceFormatted = `₹${(plan.monthlyPriceInPaise / 100).toLocaleString('en-IN')}`;
                const isMetered = plan.billingMode === 'metered';

                return (
                  <tr key={plan.id} className="hover:bg-slate-50/80 transition-colors">
                    {/* Tier Name & Badges */}
                    <td>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 text-sm">{plan.name}</span>
                          {plan.badge && (
                            <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                              {plan.badge}
                            </span>
                          )}
                          {plan.isDefault && (
                            <span
                              className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1"
                              title="Default plan for new self-registrations"
                            >
                              <Star size={10} className="fill-amber-500 text-amber-500" />
                              Default
                            </span>
                          )}
                        </div>
                        {plan.description && (
                          <div className="text-xs text-slate-500 mt-0.5 max-w-md line-clamp-1">
                            {plan.description}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Capacity & Storage */}
                    <td>
                      <div className="flex flex-col gap-0.5 text-xs text-slate-700 font-medium">
                        <div className="flex items-center gap-1.5 tabular-nums">
                          <Users size={13} className="text-slate-400" />
                          <span>
                            <span className="font-semibold text-slate-900">{plan.seatCount}</span>{' '}
                            <span className="text-slate-500 font-normal">
                              {isMetered ? 'seat cap (metered)' : 'seats included'}
                            </span>
                          </span>
                        </div>
                        {plan.storageQuotaGb && (
                          <div className="flex items-center gap-1 text-[11px] text-slate-400">
                            <HardDrive size={11} />
                            <span>{plan.storageQuotaGb} GB per mailbox</span>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Pricing */}
                    <td>
                      <div className="tabular-nums">
                        <span className="text-sm font-bold text-slate-900">{priceFormatted}</span>
                        <span className="text-xs text-slate-500 font-normal ml-1">
                          {isMetered ? '/ seat / mo' : '/ mo'}
                        </span>
                      </div>
                    </td>

                    {/* Display Order */}
                    <td>
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-slate-100 text-slate-600 text-xs font-semibold tabular-nums">
                        {plan.displayOrder}
                      </span>
                    </td>

                    {/* Checkout Status */}
                    <td>
                      {plan.isActive ? (
                        <StatusBadge status="success">Active</StatusBadge>
                      ) : (
                        <StatusBadge status="inactive">Inactive</StatusBadge>
                      )}
                    </td>

                    {/* Actions Toolbar */}
                    <td style={{ textAlign: 'right' }}>
                      <div className="inline-flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => onEditPlan(plan)}
                          title="Edit plan"
                          className="h-8 px-2.5 text-xs"
                        >
                          <Pencil size={13} />
                          <span className="ml-1 hidden sm:inline">Edit</span>
                        </Button>

                        <button
                          type="button"
                          onClick={() => onToggleActive(plan)}
                          title={plan.isActive ? 'Deactivate (hide from pickers)' : 'Activate (show in pickers)'}
                          className={`h-8 px-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                            plan.isActive
                              ? 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          {plan.isActive ? (
                            <>
                              <EyeOff size={13} className="text-slate-400" />
                              <span className="hidden sm:inline">Hide</span>
                            </>
                          ) : (
                            <>
                              <Eye size={13} className="text-emerald-600" />
                              <span className="hidden sm:inline">Publish</span>
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ========================================================================= */
        /* MODE B: VISUAL CARDS (CUSTOMER CHECKOUT PREVIEW)                          */
        /* ========================================================================= */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredPlans.map((plan) => {
            const priceFormatted = `₹${(plan.monthlyPriceInPaise / 100).toLocaleString('en-IN')}`;
            const isMetered = plan.billingMode === 'metered';

            return (
              <div
                key={plan.id}
                className={`bg-white rounded-2xl border transition-all p-5 flex flex-col justify-between shadow-xs hover:shadow-md ${
                  plan.isDefault
                    ? 'border-indigo-600 ring-2 ring-indigo-600/10'
                    : plan.isActive
                    ? 'border-slate-200 hover:border-slate-300'
                    : 'border-slate-200/70 bg-slate-50/40 opacity-75 hover:opacity-100'
                }`}
              >
                <div>
                  {/* Top Badge Strip */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-1.5">
                      {plan.badge && (
                        <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                          {plan.badge}
                        </span>
                      )}
                      {plan.isDefault && (
                        <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                          <Star size={10} className="fill-amber-500 text-amber-500" />
                          Default
                        </span>
                      )}
                    </div>
                    {plan.isActive ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                        Draft
                      </span>
                    )}
                  </div>

                  {/* Plan Name & Price */}
                  <h3 className="text-lg font-bold text-slate-900 tracking-tight">{plan.name}</h3>
                  {plan.description && (
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                      {plan.description}
                    </p>
                  )}

                  <div className="mt-4 pb-4 border-b border-slate-100">
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-extrabold text-slate-900 tabular-nums">
                        {priceFormatted}
                      </span>
                      <span className="text-xs text-slate-500 font-normal">
                        {isMetered ? '/ seat / month' : '/ month'}
                      </span>
                    </div>
                    <div className="text-xs text-indigo-600 font-medium mt-1">
                      {isMetered ? `Pay as you grow up to ${plan.seatCount} seats` : `Fixed pack of ${plan.seatCount} mailboxes`}
                    </div>
                  </div>

                  {/* Features List */}
                  <div className="mt-4 space-y-2 text-xs text-slate-600">
                    <div className="flex items-center gap-2">
                      <Users size={13} className="text-slate-400 shrink-0" />
                      <span>Up to <strong>{plan.seatCount}</strong> employee mailboxes</span>
                    </div>
                    {plan.storageQuotaGb && (
                      <div className="flex items-center gap-2">
                        <HardDrive size={13} className="text-slate-400 shrink-0" />
                        <span><strong>{plan.storageQuotaGb} GB</strong> storage per mailbox</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Sparkles size={13} className="text-indigo-500 shrink-0" />
                      <span>Automated DKIM, SPF &amp; MX verification</span>
                    </div>
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400">
                    Order: <strong className="text-slate-600 font-semibold">#{plan.displayOrder}</strong>
                  </span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => onEditPlan(plan)} className="h-8 px-2.5 text-xs">
                      <Pencil size={13} />
                      <span className="ml-1">Edit</span>
                    </Button>
                    <Button
                      size="sm"
                      variant={plan.isActive ? 'ghost' : 'secondary'}
                      onClick={() => onToggleActive(plan)}
                      className="h-8 px-2.5 text-xs"
                    >
                      {plan.isActive ? <EyeOff size={13} /> : <Eye size={13} />}
                      <span className="ml-1">{plan.isActive ? 'Hide' : 'Publish'}</span>
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

import React from 'react';
import { Layers, Users, RefreshCw, Plus, Pencil, Star, EyeOff, Eye } from 'lucide-react';
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
  const sortedPlans = [...plans].sort((a, b) => a.displayOrder - b.displayOrder || a.seatCount - b.seatCount);

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-slate-900">Plans &amp; Seat Tiers</h2>
          <p className="text-xs text-slate-500">
            Seat tiers customers can choose when adding a domain — edit these instead of shipping a code change.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
          <Button size="sm" variant="secondary" onClick={onRefresh} disabled={loading} title="Refresh plans" className="min-h-[44px] sm:min-h-0">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </Button>
          <Button size="sm" variant="primary" onClick={onCreatePlan} icon={<Plus className="w-4 h-4" />} className="min-h-[44px] sm:min-h-0">
            New Plan
          </Button>
        </div>
      </div>

      <div className="data-table-container">
        {loading && plans.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-xs">Loading plans...</div>
        ) : sortedPlans.length === 0 ? (
          <div className="p-12 text-center">
            <Layers size={36} className="mx-auto mb-3 text-slate-300" />
            <div className="text-sm font-semibold text-slate-800 mb-1">No Plans Configured</div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Click "New Plan" to define the first seat tier customers can choose from.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Plan</th>
                    <th>Seats</th>
                    <th>Price</th>
                    <th>Display Order</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPlans.map((plan) => (
                    <tr key={plan.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100">
                            <Layers size={15} />
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-900 text-xs">{plan.name}</span>
                              {plan.badge && (
                                <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                  {plan.badge}
                                </span>
                              )}
                              {plan.isDefault && (
                                <span
                                  className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex items-center gap-0.5"
                                  title="Default plan for new self-registrations"
                                >
                                  <Star size={9} className="fill-amber-500 text-amber-500" />
                                  Default
                                </span>
                              )}
                            </div>
                            {plan.description && (
                              <div className="text-[11px] text-slate-400 mt-0.5">{plan.description}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5 text-xs text-slate-700 font-medium tabular-nums">
                          <Users size={13} className="text-slate-400" />
                          {plan.billingMode === 'metered' ? `${plan.seatCount} (cap)` : plan.seatCount}
                        </div>
                      </td>
                      <td>
                        <span className="text-xs text-slate-700 font-medium tabular-nums">
                          ₹{(plan.monthlyPriceInPaise / 100).toLocaleString('en-IN')}
                          {plan.billingMode === 'metered' ? ' / seat' : ' / mo'}
                        </span>
                      </td>
                      <td>
                        <span className="text-xs text-slate-500 tabular-nums">{plan.displayOrder}</span>
                      </td>
                      <td>
                        {plan.isActive ? (
                          <StatusBadge status="success">Active</StatusBadge>
                        ) : (
                          <StatusBadge status="inactive">Inactive</StatusBadge>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="inline-flex items-center gap-1">
                          <Button size="sm" variant="secondary" onClick={() => onEditPlan(plan)} title="Edit plan">
                            <Pencil size={14} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onToggleActive(plan)}
                            title={plan.isActive ? 'Deactivate (hide from pickers)' : 'Activate (show in pickers)'}
                            className={
                              plan.isActive
                                ? 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                                : 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50'
                            }
                          >
                            {plan.isActive ? <EyeOff size={14} /> : <Eye size={14} />}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Cards View */}
            <div className="md:hidden space-y-3 p-1">
              {sortedPlans.map((plan) => (
                <div
                  key={plan.id}
                  className="p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 shadow-xs transition-all space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100 mt-0.5">
                        <Layers size={16} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-slate-900 text-sm">{plan.name}</span>
                          {plan.badge && (
                            <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                              {plan.badge}
                            </span>
                          )}
                          {plan.isDefault && (
                            <span
                              className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex items-center gap-0.5"
                              title="Default plan for new self-registrations"
                            >
                              <Star size={9} className="fill-amber-500 text-amber-500" />
                              Default
                            </span>
                          )}
                        </div>
                        {plan.description && (
                          <div className="text-xs text-slate-500 mt-1 line-clamp-2">{plan.description}</div>
                        )}
                      </div>
                    </div>
                    {plan.isActive ? (
                      <StatusBadge status="success">Active</StatusBadge>
                    ) : (
                      <StatusBadge status="inactive">Inactive</StatusBadge>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100">
                    <div className="bg-slate-50 rounded-lg p-2.5">
                      <div className="text-[11px] text-slate-500 uppercase tracking-wider font-medium mb-1">Seats</div>
                      <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                        <Users size={13} className="text-slate-400" />
                        {plan.billingMode === 'metered' ? `${plan.seatCount} (cap)` : plan.seatCount}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2.5">
                      <div className="text-[11px] text-slate-500 uppercase tracking-wider font-medium mb-1">Price</div>
                      <div className="font-semibold text-slate-800">
                        ₹{(plan.monthlyPriceInPaise / 100).toLocaleString('en-IN')}
                        <span className="text-[11px] text-slate-500 font-normal">
                          {plan.billingMode === 'metered' ? ' / seat' : ' / mo'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 pt-1">
                    <span>Display Order: <strong className="text-slate-700 font-semibold">{plan.displayOrder}</strong></span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onEditPlan(plan)}
                        className="min-h-[44px] px-3 flex items-center gap-1.5"
                      >
                        <Pencil size={14} />
                        <span>Edit</span>
                      </Button>
                      <Button
                        size="sm"
                        variant={plan.isActive ? 'ghost' : 'secondary'}
                        onClick={() => onToggleActive(plan)}
                        className={`min-h-[44px] px-3 flex items-center gap-1.5 ${
                          plan.isActive
                            ? 'text-slate-600 hover:text-slate-800 hover:bg-slate-100'
                            : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'
                        }`}
                      >
                        {plan.isActive ? <EyeOff size={14} /> : <Eye size={14} />}
                        <span>{plan.isActive ? 'Hide' : 'Activate'}</span>
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
};

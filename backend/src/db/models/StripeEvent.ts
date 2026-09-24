import mongoose, { Schema, Document } from 'mongoose';

// One row per Stripe webhook event we have handled. The unique eventId is what makes redelivery
// (Stripe retries on any non-2xx, and can deliver the same event twice) safe: the second delivery
// fails the insert and is skipped.
export interface IStripeEvent extends Document {
  eventId: string;
  type: string;
  createdAt: Date;
}

const StripeEventSchema = new Schema<IStripeEvent>(
  {
    eventId: { type: String, required: true, unique: true },
    type: { type: String, required: true },
    // Old rows are useless after Stripe's own retry window (3 days), keep a week.
    createdAt: { type: Date, default: Date.now, expires: 7 * 24 * 60 * 60 },
  },
  { versionKey: false }
);

export const StripeEventModel = mongoose.model<IStripeEvent>('StripeEvent', StripeEventSchema);

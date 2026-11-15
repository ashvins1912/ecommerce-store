import mongoose, { Schema, type Model } from 'mongoose';

const ProviderInviteSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true, index: true },
  sellerId: { type: String, required: true, index: true },
  email: { type: String, lowercase: true, trim: true, default: '' },
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED'], default: 'PENDING', index: true },
  expiresAt: { type: Date, required: true, index: true },
  acceptedProviderId: { type: String, default: null },
  acceptedAt: { type: Date, default: null },
}, { timestamps: true });
ProviderInviteSchema.index({ sellerId: 1, email: 1, status: 1 });

const ProviderProfileSchema = new Schema({
  userId: { type: String, required: true, unique: true, index: true },
  linkedSellerIds: { type: [String], default: [], index: true },
  businessName: { type: String, required: true, trim: true },
  contactPerson: { type: String, required: true, trim: true },
  mobile: { type: String, required: true },
  whatsapp: { type: String, default: '' },
  warehouseAddress: { type: String, required: true },
  encryptedTaxId: { type: String, required: true, select: false },
  encryptedSettlementDetails: { type: String, required: true, select: false },
  settlementDetailsLast4: { type: String, default: '' },
  kycStatus: { type: String, enum: ['PENDING', 'VERIFIED', 'REJECTED'], default: 'PENDING', index: true },
}, { timestamps: true });

const ProviderProductSchema = new Schema({
  providerId: { type: String, required: true, index: true },
  linkedSellerIds: { type: [String], default: [], index: true },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  category: { type: String, required: true, trim: true },
  subCategory: { type: String, default: '' },
  description: { type: String, required: true, maxlength: 5000 },
  brand: { type: String, default: '' },
  manufacturerName: { type: String, required: true },
  manufacturingDate: { type: Date, default: null },
  sizeVariants: { type: [String], default: [] },
  colorVariants: { type: [String], default: [] },
  imageUrls: { type: [String], default: [] },
  basePricePaise: { type: Number, required: true, min: 1 },
  returnable: { type: Boolean, default: true },
  returnWindowDays: { type: Number, default: 7, min: 0, max: 90 },
  damageReplacementPolicy: { type: String, default: '', maxlength: 2000 },
  status: { type: String, enum: ['DRAFT', 'PENDING_REVIEW', 'NEGOTIATION_REQUESTED', 'RESUBMITTED', 'APPROVED', 'APPROVED_AND_PUBLISHED', 'REJECTED'], default: 'DRAFT', index: true },
  retailProductId: { type: String, default: null, index: true },
  negotiationHistory: [{ sellerId: String, actorId: String, action: String, fields: [String], targetPricePaise: Number, comment: String, createdAt: { type: Date, default: Date.now } }],
  approvedBasePricePaise: { type: Number, default: null },
  approvedAt: { type: Date, default: null },
}, { timestamps: true });
ProviderProductSchema.index({ providerId: 1, status: 1, updatedAt: -1 });
ProviderProductSchema.index({ linkedSellerIds: 1, status: 1, updatedAt: -1 });

const ProviderSettlementSchema = new Schema({
  orderId: { type: String, required: true, index: true },
  orderItemKey: { type: String, required: true },
  sellerId: { type: String, required: true, index: true },
  providerId: { type: String, required: true, index: true },
  providerProductId: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitBasePricePaise: { type: Number, required: true, min: 1 },
  amountPaise: { type: Number, required: true, min: 1 },
  currency: { type: String, default: 'INR' },
  status: { type: String, enum: ['PENDING_CLEARANCE', 'READY_FOR_SETTLEMENT', 'ADJUSTED', 'VOID', 'SETTLED'], default: 'PENDING_CLEARANCE', index: true },
  availableAt: { type: Date, required: true, index: true },
  deductionsPaise: { type: Number, default: 0, min: 0 },
  utrReference: { type: String, default: '' },
  settledAt: { type: Date, default: null },
  encryptedReceipt: { type: String, default: '', select: false },
}, { timestamps: true });
ProviderSettlementSchema.index({ orderId: 1, orderItemKey: 1 }, { unique: true });
ProviderSettlementSchema.index({ sellerId: 1, status: 1, createdAt: -1 });
ProviderSettlementSchema.index({ providerId: 1, status: 1, createdAt: -1 });

const ProviderAuditSchema = new Schema({
  actorId: { type: String, required: true, index: true },
  actorRole: { type: String, required: true },
  action: { type: String, required: true, index: true },
  providerId: { type: String, default: '' },
  resourceId: { type: String, default: '' },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: { createdAt: true, updatedAt: false } });

export const ProviderInviteModel: Model<any> = mongoose.models.ProviderInvite || mongoose.model('ProviderInvite', ProviderInviteSchema);
export const ProviderProfileModel: Model<any> = mongoose.models.ProviderProfile || mongoose.model('ProviderProfile', ProviderProfileSchema);
export const ProviderProductModel: Model<any> = mongoose.models.ProviderProduct || mongoose.model('ProviderProduct', ProviderProductSchema);
export const ProviderSettlementModel: Model<any> = mongoose.models.ProviderSettlement || mongoose.model('ProviderSettlement', ProviderSettlementSchema);
export const ProviderAuditModel: Model<any> = mongoose.models.ProviderAudit || mongoose.model('ProviderAudit', ProviderAuditSchema);

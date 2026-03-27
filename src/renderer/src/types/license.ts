export type LicenseStatus = 'unchecked' | 'checking' | 'valid' | 'invalid' | 'expired' | 'grace'
export type LicensePlan = 'monthly' | 'yearly' | 'lifetime'

export interface LicenseInfo {
  status: LicenseStatus
  plan?: LicensePlan
  email?: string
  lastValidated?: number
  error?: string
}

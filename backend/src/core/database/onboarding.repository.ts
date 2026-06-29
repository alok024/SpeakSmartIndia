import { sb } from './base';
import type { UserRow } from './base';

export const onboardingRepo = {

  // Onboarding

  async saveOnboarding(
    userId: string,
    profession: string,
    goal: string
  ): Promise<void> {
    await sb(`/users?id=eq.${encodeURIComponent(userId)}`, 'PATCH', {
      onboarding_profession:   profession,
      onboarding_goal:         goal,
      onboarding_completed_at: new Date().toISOString(),
    });
  },

  // DAF (UPSC Detailed Application Form)
  //
  // Saves all DAF fields in a single PATCH. Nullable fields are left
  // null when the user has not filled them yet — the prompt layer skips
  // any null field rather than injecting an empty string.

  async saveDAF(userId: string, fields: {
    name?:               string | null;
    home_state?:         string | null;
    graduation_subject?: string | null;
    graduation_college?: string | null;
    optional_subject?:   string | null;
    hobbies?:            string | null;
    work_experience?:    string | null;
    extracurriculars?:   string | null;
  }): Promise<void> {
    await sb(`/users?id=eq.${encodeURIComponent(userId)}`, 'PATCH', {
      daf_name:               fields.name               ?? null,
      daf_home_state:         fields.home_state         ?? null,
      daf_graduation_subject: fields.graduation_subject ?? null,
      daf_graduation_college: fields.graduation_college ?? null,
      daf_optional_subject:   fields.optional_subject   ?? null,
      daf_hobbies:            fields.hobbies            ?? null,
      daf_work_experience:    fields.work_experience    ?? null,
      daf_extracurriculars:   fields.extracurriculars   ?? null,
    });
  },

  // Company mode persistence
  //
  // Saves the user's last-selected company target for campus interview
  // mode. null clears the preference (generic prep, no company context).

  async saveCompanyMode(userId: string, companyMode: string | null): Promise<void> {
    await sb(`/users?id=eq.${encodeURIComponent(userId)}`, 'PATCH', {
      last_company_mode: companyMode,
    });
  },

  
};


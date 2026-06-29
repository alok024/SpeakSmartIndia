
export interface PrepPathDaySessionConfig {
  profession:     string;
  mode:           string;
  difficulty:     string;
  interview_type: string;
}

export interface PrepPathDay {
  day_number:     number;
  title:          string;
  session_config: PrepPathDaySessionConfig;
}

export interface PrepPath {
  id:            string;
  title:         string;
  description:   string;
  duration_days: number;
  profession:    string;
}

export interface MyEnrollmentResponse {
  enrollment: {
    id:           string;
    enrolled_at:  string;
    prep_path_id: string;
  } | null;
  path?: {
    id:            string;
    title:         string;
    duration_days: number;
  } | null;
  current_day?: number;
  is_complete?: boolean;
  today?:       PrepPathDay;
}

export interface EnrollResponse {
  enrollment: { id: string; enrolled_at: string; prep_path_id: string };
  current_day: number;
  today:       PrepPathDay;
}

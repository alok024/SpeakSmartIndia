/**
 * features/user/types/results-board.ts
 *
 * Types for the Job Landed + Results Board feature.
 */

/** POST /api/user/job-landed request body */
export interface JobLandedInput {
  role:         string;
  company?:     string;
  displayName:  string;
  showOnBoard:  boolean;
}

/** POST /api/user/job-landed response */
export interface JobLandedResponse {
  og_image_url:      string;
  results_board_url: string | null;
}

/** Single entry on the public Results Board */
export interface ResultsBoardEntry {
  id:             string;
  display_name:   string;
  role:           string;
  company:        string | null;
  sessions_count: number;
  avg_score:      number | null;
  og_image_url:   string;
  created_at:     string;
}

/** GET /api/user/results-board response */
export interface ResultsBoardResponse {
  entries:   ResultsBoardEntry[];
  total:     number;
  page:      number;
  page_size: number;
}

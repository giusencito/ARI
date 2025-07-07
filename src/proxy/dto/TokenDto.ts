export class TokenDto {
  access_token: string;
  expires_in: number;
  refresh_expires_in: number;
  token_type: string;
  refresh_token: string;
  session_state: string;
  scope: string;
}

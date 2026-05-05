/** JSON body for `GET /admin/profile` (matches client `AdminProfileResponse`). */
export type AdminProfileResponse = {
  username: string;
  email: string;
  avatar: string | null;
};

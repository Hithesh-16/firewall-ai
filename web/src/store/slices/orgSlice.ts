import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface Org {
  id: string;
  name: string;
  slug: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
}

export interface OrgMember {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface OrgState {
  organizations: Org[];
  currentOrgId: string | null;
  teams: Team[];
  members: OrgMember[];
}

const initialState: OrgState = {
  organizations: [],
  currentOrgId: null,
  teams: [],
  members: [],
};

export const orgSlice = createSlice({
  name: "org",
  initialState,
  reducers: {
    setOrganizations(state, action: PayloadAction<Org[]>) {
      return { ...state, organizations: action.payload };
    },
    setCurrentOrg(state, action: PayloadAction<string>) {
      return { ...state, currentOrgId: action.payload };
    },
    setTeams(state, action: PayloadAction<Team[]>) {
      return { ...state, teams: action.payload };
    },
    setMembers(state, action: PayloadAction<OrgMember[]>) {
      return { ...state, members: action.payload };
    },
  },
});

export const { setOrganizations, setCurrentOrg, setTeams, setMembers } =
  orgSlice.actions;
export default orgSlice.reducer;

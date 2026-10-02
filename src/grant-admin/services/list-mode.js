// A list page is a browse, or with a ref, a search of that ref's series.
export const SEARCH = "search";
export const BROWSE = "browse";

export const modeOf = ({ ref }) => (ref ? SEARCH : BROWSE);

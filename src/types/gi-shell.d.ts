declare module "gi://Shell" {
  const Shell: {
    WindowTracker: {
      get_default(): {
        get_window_app(window: any): { get_id(): string; get_name(): string };
      };
    };
    ActionMode: {
      NONE: number;
      NORMAL: number;
      OVERVIEW: number;
      LOCK_SCREEN: number;
      UNLOCK_SCREEN: number;
      LOGIN_SCREEN: number;
      SYSTEM_MODAL: number;
      LOOKING_GLASS: number;
      POPUP: number;
      ALL: number;
    };
  };
  export default Shell;
}

import { Icon, ICONS } from "./Icon";

type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: string;
  group: "Work" | "Insights" | "Content";
  badge?: string;
};

const items: NavItem[] = [
  { id: "overview", label: "Overview", href: "/dashboard", icon: ICONS.chart, group: "Work" },
  { id: "inbox", label: "Inbox", href: "/dashboard/inbox", icon: ICONS.inbox, group: "Work" },
  { id: "leads", label: "Leads", href: "/dashboard/leads", icon: ICONS.user, group: "Work" },
  { id: "issues", label: "Issues", href: "/dashboard/issues", icon: ICONS.alert, group: "Work" },
  { id: "appointments", label: "Appointments", href: "/dashboard/appointments", icon: ICONS.cal, group: "Work" },
  { id: "performance", label: "Performance", href: "/dashboard/performance", icon: ICONS.chart, group: "Insights" },
  { id: "ab-testing", label: "A/B Testing", href: "/dashboard/ab-testing", icon: ICONS.zap, group: "Insights" },
  { id: "templates", label: "Templates", href: "/dashboard/templates", icon: ICONS.msg, group: "Content" },
  { id: "review", label: "Review queue", href: "/dashboard/review", icon: ICONS.flag, group: "Content" }
];

const groups: NavItem["group"][] = ["Work", "Insights", "Content"];

type SidebarProps = {
  active: string;
};

export function Sidebar({ active }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Dashboard navigation">
      <div className="brand">
        <div className="brand-mark">
          <Icon d={ICONS.shield} size={15} stroke="#fff" sw={2} />
        </div>
        <div>
          <strong>Accident Support Desk</strong>
          <span>Operator console</span>
        </div>
      </div>

      <nav className="nav">
        {groups.map((group) => (
          <div className="nav-group" key={group}>
            <div className="nav-label">{group}</div>
            {items
              .filter((item) => item.group === group)
              .map((item) => (
                <a className={item.id === active ? "nav-item active" : "nav-item"} href={item.href} key={item.id}>
                  <Icon d={item.icon} size={14} />
                  <span>{item.label}</span>
                  {item.badge ? <em>{item.badge}</em> : null}
                </a>
              ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <span>Bot status</span>
        <strong>
          <i />
          Live
        </strong>
      </div>
    </aside>
  );
}

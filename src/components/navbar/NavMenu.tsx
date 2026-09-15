import { Link, useLocation } from 'react-router-dom';
import { NavigationDropdown } from './NavDropdowns';
import { isActive, getCurrentNavItem, type NavItem } from './constants';

interface NavMenuProps {
    navItems: NavItem[];
}

/**
 * 导航菜单组件 - 独立处理响应式
 * 
 * 响应式策略:
 * - ≥ 880px: 文字胶囊
 * - 480px - 880px: 三项图标胶囊
 * - < 480px: 下拉菜单
 */
export function NavMenu({ navItems }: NavMenuProps) {
    const location = useLocation();
    // 定制版只保留固定的三项主导航，旧配置中的隐藏项不再影响核心入口。
    const visibleNavItems = navItems;

    return (
        <>
            {/* 文字胶囊 (≥ 880px) */}
            <nav className="hidden min-[880px]:flex items-center gap-1 rounded-full bg-gray-100 p-1 dark:bg-base-200">
                {visibleNavItems.map((item) => (
                    <Link
                        key={item.path}
                        to={item.path}
                        draggable="false"
                        className={`
                            px-4 xl:px-6
                            py-2 
                            rounded-full 
                            text-sm 
                            font-medium 
                            transition-colors
                            whitespace-nowrap
                            ${isActive(location.pathname, item.path)
                                ? 'bg-gray-900 text-white shadow-sm dark:bg-white dark:text-gray-900'
                                : 'text-gray-700 hover:text-gray-900 hover:bg-gray-200 dark:text-gray-400 dark:hover:text-base-content dark:hover:bg-base-100'
                            }
                        `}
                    >
                        {item.label}
                    </Link>
                ))}
            </nav>

            {/* 图标胶囊 (480px - 880px) */}
            <nav className="hidden min-[480px]:flex min-[880px]:hidden items-center gap-1 rounded-full bg-gray-100 p-1 dark:bg-base-200">
                {visibleNavItems.map((item) => (
                    <Link
                        key={item.path}
                        to={item.path}
                        draggable="false"
                        className={`
                            p-2
                            rounded-full
                            transition-colors
                            ${isActive(location.pathname, item.path)
                                ? 'bg-gray-900 text-white shadow-sm dark:bg-white dark:text-gray-900'
                                : 'text-gray-700 hover:text-gray-900 hover:bg-gray-200 dark:text-gray-400 dark:hover:text-base-content dark:hover:bg-base-100'
                            }
                        `}
                        title={item.label}
                    >
                        <item.icon className="w-5 h-5" />
                    </Link>
                ))}
            </nav>

            {/* 图标+文字下拉 (375px - 480px) */}
            <div className="max-[374px]:hidden min-[480px]:hidden block">
                <NavigationDropdown
                    navItems={visibleNavItems}
                    isActive={(path) => isActive(location.pathname, path)}
                    getCurrentNavItem={() => getCurrentNavItem(location.pathname, visibleNavItems)}
                    onNavigate={() => { }}
                    showLabel={true}
                />
            </div>

            {/* 图标下拉 (< 375px) */}
            <div className="min-[375px]:hidden">
                <NavigationDropdown
                    navItems={visibleNavItems}
                    isActive={(path) => isActive(location.pathname, path)}
                    getCurrentNavItem={() => getCurrentNavItem(location.pathname, visibleNavItems)}
                    onNavigate={() => { }}
                    showLabel={false}
                />
            </div>
        </>
    );
}

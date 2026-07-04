export const publicHeaderStyles = `
        .header-auth-actions {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-shrink: 0;
        }
        .btn-outline-white {
            background: transparent;
            color: var(--text-primary);
            border: 1.5px solid rgba(241, 241, 245, 0.35);
            transition: all 0.2s ease;
        }
        .btn-outline-white:hover {
            border-color: var(--accent-blue);
            color: var(--text-primary);
            background: rgba(79, 142, 247, 0.08);
            transform: translateY(-1px);
        }
        .header-auth-actions .btn-primary {
            transition: all 0.2s ease;
        }
        .header-auth-actions .btn-primary:hover {
            transform: translateY(-1px);
        }

        .header-nav-wrap {
            display: flex;
            align-items: center;
            gap: 28px;
        }
        .header-nav-wrap .nav {
            display: flex;
            align-items: center;
            gap: 28px;
        }
        .header-nav-wrap .nav a.active {
            color: var(--text-primary);
        }

        .header-menu-toggle {
            display: none;
            background: none;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm, 8px);
            color: var(--text-primary);
            width: 40px;
            height: 40px;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 18px;
            transition: border-color 0.2s, background 0.2s;
        }
        .header-menu-toggle:hover {
            border-color: var(--accent-blue);
            background: rgba(79, 142, 247, 0.06);
        }

        .user-menu {
            position: relative;
        }
        .user-menu-trigger {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px 6px 8px;
            border-radius: var(--radius-md, 12px);
            border: 1px solid var(--border);
            background: var(--bg-card, #16161F);
            color: var(--text-primary);
            cursor: pointer;
            font-family: inherit;
            font-size: 13px;
            font-weight: 500;
            transition: border-color 0.2s, background 0.2s;
            max-width: 180px;
        }
        .user-menu-trigger:hover {
            border-color: rgba(79, 142, 247, 0.45);
            background: var(--bg-card-hover, #1E1E2A);
        }
        .user-menu-avatar {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: var(--gradient-hero, linear-gradient(135deg, #4F8EF7, #8B5CF6));
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            flex-shrink: 0;
        }
        .user-menu-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .user-menu-chevron {
            font-size: 10px;
            color: var(--text-muted);
            flex-shrink: 0;
        }
        .user-menu-dropdown {
            position: absolute;
            top: calc(100% + 8px);
            right: 0;
            min-width: 200px;
            background: var(--bg-card, #16161F);
            border: 1px solid var(--border);
            border-radius: var(--radius-md, 12px);
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
            padding: 6px;
            z-index: 1100;
            animation: user-menu-in 0.15s ease;
        }
        @keyframes user-menu-in {
            from { opacity: 0; transform: translateY(-4px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .user-menu-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            border-radius: var(--radius-sm, 8px);
            color: var(--text-secondary);
            text-decoration: none;
            font-size: 13.5px;
            transition: background 0.2s, color 0.2s;
            border: none;
            background: none;
            width: 100%;
            text-align: left;
            cursor: pointer;
            font-family: inherit;
        }
        .user-menu-item:hover {
            background: var(--bg-card-hover, #1E1E2A);
            color: var(--text-primary);
        }
        .user-menu-item.danger {
            color: var(--accent-red, #EF4444);
        }
        .user-menu-item.danger:hover {
            background: rgba(239, 68, 68, 0.08);
            color: var(--accent-red, #EF4444);
        }
        .user-menu-divider {
            height: 1px;
            background: var(--border);
            margin: 4px 8px;
        }
        .user-menu-trigger--admin {
            border-color: rgba(79, 142, 247, 0.35);
            background: rgba(79, 142, 247, 0.06);
            max-width: 260px;
        }
        .user-menu-trigger--admin:hover {
            border-color: rgba(79, 142, 247, 0.55);
            background: rgba(79, 142, 247, 0.1);
        }
        .user-menu-role-tag {
            font-size: 9px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: var(--accent-blue, #4F8EF7);
            background: rgba(79, 142, 247, 0.12);
            padding: 2px 6px;
            border-radius: 999px;
            flex-shrink: 0;
        }
        .user-menu-trigger-badge {
            min-width: 18px;
            height: 18px;
            padding: 0 5px;
            border-radius: 999px;
            background: #F59E0B;
            color: #000;
            font-size: 10px;
            font-weight: 700;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        .user-menu-dropdown--admin {
            min-width: 240px;
        }
        .user-menu-section-label {
            padding: 8px 12px 4px;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            color: var(--text-muted);
        }
        .user-menu-item-admin {
            justify-content: flex-start;
        }
        .user-menu-item-label {
            flex: 1;
        }
        .user-menu-pending-badge {
            min-width: 20px;
            height: 20px;
            padding: 0 6px;
            border-radius: 999px;
            background: #F59E0B;
            color: #000;
            font-size: 11px;
            font-weight: 700;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-left: auto;
        }

        @media (max-width: 900px) {
            .header .container {
                flex-wrap: wrap;
                gap: 12px;
            }
            .header-menu-toggle {
                display: inline-flex;
                margin-left: auto;
            }
            .header-nav-wrap {
                display: none;
                width: 100%;
                flex-direction: column;
                align-items: stretch;
                gap: 16px;
                padding: 12px 0 4px;
                border-top: 1px solid var(--border);
            }
            .header-nav-wrap.is-open {
                display: flex;
            }
            .header-nav-wrap .nav {
                flex-direction: column;
                align-items: flex-start;
                gap: 4px;
                width: 100%;
            }
            .header-nav-wrap .nav a {
                width: 100%;
                padding: 10px 4px;
            }
            .header-auth-actions {
                width: 100%;
                flex-direction: column;
                align-items: stretch;
            }
            .header-auth-actions .btn {
                width: 100%;
                justify-content: center;
            }
            .user-menu {
                width: 100%;
            }
            .user-menu-trigger {
                width: 100%;
                max-width: none;
            }
            .user-menu-dropdown {
                right: 0;
                left: 0;
            }
        }

        @media (max-width: 480px) {
            .header-auth-actions:not(.header-auth-actions--stack) {
                flex-direction: row;
                flex-wrap: wrap;
            }
            .header-auth-actions:not(.header-auth-actions--stack) .btn-sm {
                padding: 7px 12px;
                font-size: 11.5px;
            }
        }
`;

@prefs
Feature: Preferences Window

  Scenario: Preferences window shows all page tabs
    Given gnome-shell is running
    When the preferences window is opened via D-Bus
    Then the preferences window shows the "Tiling" page tab
    And the preferences window shows the "Appearance" page tab
    And the preferences window shows the "Keyboard" page tab
    And the preferences window shows the "Windows" page tab

  Scenario Outline: Switch "<name>" checked state matches gsetting
    Given gnome-shell is running
    When the preferences window is opened via D-Bus
    Then switch "<name>" checked state matches gsetting "<key>"
    And after toggling gsetting "<key>", switch "<name>" state updates

    Examples:
      | name                    | key                           |
      | Focus on Hover          | focus-on-hover-enabled        |
      | Move pointer with focused window | move-pointer-focus-enabled |
      | Quarter tiling          | auto-split-enabled            |
      | Stacked tiling          | stacked-tiling-mode-enabled   |
      | Tabbed tiling           | tabbed-tiling-mode-enabled    |
      | Auto exit tabbed tiling | auto-exit-tabbed              |
      | Always on Top mode for floating windows | float-always-on-top-enabled |

  Scenario: Page tab navigation works
    Given gnome-shell is running
    When the preferences window is opened via D-Bus
    Then clicking the "Tiling" page tab navigates without error
    And clicking the "Appearance" page tab navigates without error
    And clicking the "Keyboard" page tab navigates without error
    And clicking the "Windows" page tab navigates without error
    And navigating back to the "Tiling" page tab

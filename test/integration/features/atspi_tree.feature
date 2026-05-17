@atspi
Feature: AT-SPI Tree Accessibility

  Scenario: AT-SPI tree is accessible
    Given gnome-shell is running
    Then the gnome-shell application is accessible in the AT-SPI tree
    And the main stage window exists
    And the main stage is not showing (headless mode)
    And the stage has children

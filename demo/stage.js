/*
 * Display poly2tri results in the browser.
 * Angular facade for the Kinetic Stage.
 *
 * (c) 2014, Rémi Turboult
 * All rights reserved.
 * Distributed under the 3-clause BSD License, see LICENSE.txt
 */

/* jshint node:true */
/* global angular */


"use strict";

module.exports = angular.module(__filename, [ ])

/**
 * KineticJS library
 */
    .value('Kinetic', Kinetic) // jshint ignore:line

/**
 * Stage styles
 */
    .constant('STAGE_STYLES', {
        TRIANGLE_FILL_COLOR: "#e0c4ef",
        TRIANGLE_STROKE_COLOR: "#911ccd",
        TRIANGLE_STROKE_WIDTH: 1,
        CONSTRAINT_COLOR: "rgba(0,0,0,0.6)",
        CONSTRAINT_DASH_ARRAY: [10, 5],
        CONSTRAINT_STROKE_WIDTH: 4,
        ERROR_COLOR: "rgba(255,0,0,0.8)",
        ERROR_RADIUS: 4,
        CANVAS_MARGIN: 5
    })

/**
 * KineticJS Stage factory
 */
    .factory('Stage', function (Kinetic, $window, STAGE_STYLES) {
        /**
         * Stage class : facade for the Kinetic Stage
         *
         * Create a new stage
         * @param {angular.element} $container - jQuery/jqLite element for the parent container
         * @constructor
         */
        var Stage = function ($container) {
            var self = this;

            // XXX remove jQuery code
            // XXX also in bower_components and bower.json

            var kStage = new Kinetic.Stage({
                container: $container[0],
                width: $container.width(),
                height: $container.height(),
                // Don't listen to events : avoid performance problems with mousemove on Firefox
                listening: false,
                draggable: true
            });
            this.kStage = kStage;

            angular.element($window).on('resize', function () {
                kStage.setSize($container.width(), $container.height());
            });

            // Zoom to point and scale
            // ("delta" has been normalized at +/-1 by the jquery-mousewheel plugin).
            $container.on('mousewheel', function onMouseWheel(e, delta) {
                //prevent the actual wheel movement
                e.preventDefault();
                self.zoomOnPointer(delta);
            });
        };


        // XXX why is it needed ? normally KineticJS should accept our {x,y} objects,
        // but it doesn't work in practice.
        function makeKineticPoints(points) {
            return points.map(function (point) {
                return [point.x, point.y];
            });
        }


        /**
         * Helper to override Kinetic.Shape.draw in order to have fixed width strokes
         * or radius, independently of scale
         * (strokeScaleEnabled = false doesn't give the expected result)
         */
        function provideFixedLineWidth(shape, setLineWidth) {
            var originalDrawFunc = shape.getDrawFunc();
            shape.setDrawFunc(function () {
                var lineScale = 1 / this.getStage().getScaleX();
                setLineWidth.call(this, lineScale);
                originalDrawFunc.apply(this, arguments);
            });
        }


        /**
         * Clear and reset stage
         */
        Stage.prototype.reset = function () {
            // clear the canvas
            this.kStage.destroyChildren();

            // reset drag
            this.kStage.setAbsolutePosition(0, 0);
        };


        /**
         * Auto scale / translate stage to contain the bounding box
         * @param {XY} min - smallest coordinates
         * @param {XY} max - biggest coordinates
         */
        Stage.prototype.setBoundingBox = function (min, max) {
            var kStage = this.kStage;
            var MARGIN = STAGE_STYLES.CANVAS_MARGIN;

            // auto scale / translate
            var xScale = (kStage.getWidth() - 2 * MARGIN) / (max.x - min.x);
            var yScale = (kStage.getHeight() - 2 * MARGIN) / (max.y - min.y);
            var scale = Math.min(xScale, yScale);
            // CANVAS_MARGIN is fixed and needs to be unscaled
            kStage.setOffset(min.x - MARGIN / scale, min.y - MARGIN / scale);
            kStage.setScale(scale);
        };


        /**
         * Get pointer position in scene coordinates
         * @returns {{x:string,y:string}} formatted coordinates
         */
        Stage.prototype.getPointerCoordinates = function () {
            var kStage = this.kStage;
            var pointer = kStage.getPointerPosition();
            if (pointer) { // can be undefined
                var stage_pos = kStage.getAbsolutePosition();
                var x = (pointer.x - stage_pos.x) / kStage.getScaleX() + kStage.getOffsetX();
                var y = (pointer.y - stage_pos.y) / kStage.getScaleY() + kStage.getOffsetY();
                var digits = Math.min(kStage.getScaleX() / 10, 5);
                return {x: x.toFixed(digits), y: y.toFixed(digits)};
            }
            return null;
        };


        /**
         * Zoom the stage (relatively to the current zoom), centered on the pointer position.
         * Adapted from "Zoom to point and scale (kineticjs+mousewheel)"
         *      http://nightlycoding.com/index.php/2013/08/zoom-to-point-and-scale-kineticjsmousewheel/
         * @param {number} delta - zoom increment, in steps of +/-1
         */
        Stage.prototype.zoomOnPointer = function (delta) {
            var kStage = this.kStage;
            var scale = kStage.getScaleX(); // scaleX === scaleY in this app

            // Change scale by +/- 10%
            var new_scale = scale * (1 + delta * 0.1);
            var pointer = kStage.getPointerPosition();
            if (new_scale > 0.0 && pointer) {
                var stage_pos = kStage.getAbsolutePosition();
                var x = pointer.x - (pointer.x - stage_pos.x) / scale * new_scale;
                var y = pointer.y - (pointer.y - stage_pos.y) / scale * new_scale;
                kStage.setPosition(x, y);
                kStage.setScale(new_scale);
                kStage.draw();
            }
        };


        /**
         * Draw triangles
         * @param {Array.<Triangle>} triangles
         */
        Stage.prototype.setTriangles = function (triangles) {
            var layer = new Kinetic.Layer({name: "triangles"});
            (triangles || []).forEach(function (t) {
                var triangle = new Kinetic.Polygon({
                    points: makeKineticPoints(t.getPoints()),
                    fill: STAGE_STYLES.TRIANGLE_FILL_COLOR,
                    stroke: STAGE_STYLES.TRIANGLE_STROKE_COLOR
                });
                provideFixedLineWidth(triangle, function (linescale) {
                    this.setStrokeWidth(STAGE_STYLES.TRIANGLE_STROKE_WIDTH * linescale);
                });
                layer.add(triangle);
            });
            this.kStage.add(layer);
        };


        /**
         * Draw constraints
         * @param {Array.<XY>} contour
         * @param {Array.<Array.<XY>>} holes
         * @param {Array.<XY>} points
         */
        Stage.prototype.setConstraints = function (contour, holes, points) {
            var layer = new Kinetic.Layer({name: "constraints"});

            if (contour && contour.length) {
                var polygon = new Kinetic.Polygon({
                    points: makeKineticPoints(contour),
                    stroke: STAGE_STYLES.CONSTRAINT_COLOR,
                    dashArrayEnabled: true
                });
                provideFixedLineWidth(polygon, function (lineScale) {
                    this.setStrokeWidth(STAGE_STYLES.CONSTRAINT_STROKE_WIDTH * lineScale);
                    var dashArray = STAGE_STYLES.CONSTRAINT_DASH_ARRAY.map(function (dash) {
                        return dash * lineScale;
                    });
                    this.setDashArray(dashArray);
                });
                layer.add(polygon);
            }

            (holes || []).forEach(function (hole) {
                var polygon = new Kinetic.Polygon({
                    points: makeKineticPoints(hole),
                    stroke: STAGE_STYLES.CONSTRAINT_COLOR,
                    dashArrayEnabled: true
                });
                provideFixedLineWidth(polygon, function (lineScale) {
                    this.setStrokeWidth(STAGE_STYLES.CONSTRAINT_STROKE_WIDTH * lineScale);
                    var dashArray = STAGE_STYLES.CONSTRAINT_DASH_ARRAY.map(function (dash) {
                        return dash * lineScale;
                    });
                    this.setDashArray(dashArray);
                });
                layer.add(polygon);
            });

            (points || []).forEach(function (point) {
                var circle = new Kinetic.Circle({
                    x: point.x,
                    y: point.y,
                    fill: STAGE_STYLES.CONSTRAINT_COLOR
                });
                provideFixedLineWidth(circle, function (lineScale) {
                    this.setRadius(STAGE_STYLES.CONSTRAINT_STROKE_WIDTH * lineScale);
                });
                layer.add(circle);
            });

            this.kStage.add(layer);
        };


        /**
         * Show or hide constraints
         * @param {boolean} visible
         */
        Stage.prototype.setConstraintsVisible = function (visible) {
            this.kStage.find('.constraints').each(function (layer) {
                layer.setVisible(visible);
            });
        };


        /**
         * Draw errors
         * @param {Array.<XY>} errorPoints
         */
        Stage.prototype.setErrors = function (errorPoints) {
            var layer = new Kinetic.Layer({name: "errors"});
            (errorPoints || []).forEach(function (point) {
                var circle = new Kinetic.Circle({
                    x: point.x,
                    y: point.y,
                    fill: STAGE_STYLES.ERROR_COLOR
                });
                provideFixedLineWidth(circle, function (lineScale) {
                    this.setRadius(STAGE_STYLES.ERROR_RADIUS * lineScale);
                });
                layer.add(circle);
            });
            this.kStage.add(layer);
        };


        /**
         * Draw stage
         */
        Stage.prototype.draw = function () {
            this.kStage.draw();
        };

        return Stage;
    })

/**
 * KineticJS stage directive.
 * Optionally export the KineticJS stage object to the parent scope, trough the "model" attribute, if specified.
 */
    .directive('stage', function ($log, Stage) {
        return {
            restrict: 'E',
            scope: {
                stageModel: '=?model',
                contour: '=',
                holes: '=',
                points: '=',
                triangles: '=',
                boundingBox: '=',
                errorPoints: '=',
                showConstraints: '=',
                onMouseMove: '&'
            },
            link: function (scope, element) {
                var stage = new Stage(element);

                // Export the KineticJS stage object to the parent scope
                scope.stageModel = stage;

                // Show or hide constraints (contour + holes + Steiner points)
                scope.$watch('showConstraints', function (newValue) {
                    stage.setConstraintsVisible(newValue);
                    // Shouldn't be needed to redraw explicitly, but sometimes when stage is created
                    // with hidden constraints, it is not possible to show the constraints again, without
                    // forcing a redraw.
                    stage.draw();
                });

                // Redraw iff triangles is modified
                // (for the time being, don't redraw if constraints are modified : wait for triangulation).
                // We use watchCollection so only a shallow comparison is done i.e. collection items such as
                // 'triangles' are compared using '===', not not deep equality. This should be sufficient
                // for this use case (each triangulation returns a new array).
                scope.$watchCollection('[ triangles, errorPoints ]', function (newValue) {
                    $log.debug("stage $watchCollection", newValue);
                    stage.reset();

                    // XXX watch separately ?
                    // XXX compute if not set ?
                    if (scope.boundingBox) {
                        stage.setBoundingBox(scope.boundingBox.min, scope.boundingBox.max);
                    }

                    // draw result
                    stage.setTriangles(scope.triangles);
                    stage.setConstraints(scope.contour, scope.holes, scope.points);
                    stage.setConstraintsVisible(scope.showConstraints);
                    if (scope.errorPoints) {
                        stage.setErrors(scope.errorPoints);
                    }
                    stage.draw();
                });
            }
        };
    });
angular.module('valdr')

  .provider('valdr', function () {

    var constraints = {}, validators = {}, constraintUrl, constraintsLoading, constraintAliases = {},
      validatorNames = [
        'valdrRequiredValidator',
        'valdrSizeValidator',
        'valdrMinLengthValidator',
        'valdrMaxLengthValidator',
        'valdrMinValidator',
        'valdrMaxValidator',
        'valdrEmailValidator',
        'valdrUrlValidator',
        'valdrDigitsValidator',
        'valdrFutureValidator',
        'valdrPastValidator',
        'valdrPatternValidator',
        'valdrHibernateEmailValidator'
      ],
      dependencies = {};

    var initDependencies = function(){
      angular.forEach(constraints, function(typeFields, typeName){
        dependencies[typeName] = {};
        angular.forEach(typeFields, function(fieldConstraints, fieldName){
          angular.forEach(fieldConstraints, function (constraint) {
            if(constraint.hasOwnProperty('requireModels')){
              angular.forEach(constraint.requireModels, function(modelName){
                if(dependencies[typeName].hasOwnProperty(modelName) && dependencies[typeName][modelName].length !== undefined){
                  dependencies[typeName][modelName].push(fieldName);
                } else {
                  dependencies[typeName][modelName] = [fieldName];
                }
              });
            }
          });
        });
      });
    };

    var addConstraints = function (newConstraints) {
      angular.extend(constraints, newConstraints);
      initDependencies();
    };

    this.addConstraints = addConstraints;

    var removeConstraints = function (constraintNames) {
      if (angular.isArray(constraintNames)) {
        angular.forEach(constraintNames, function (name) {
          delete constraints[name];
          delete dependencies[name];
        });
      } else if (angular.isString(constraintNames)) {
        delete constraints[constraintNames];
      }
    };

    this.removeConstraints = removeConstraints;

    this.setConstraintUrl = function (url) {
      constraintUrl = url;
    };

    this.addValidator = function (validatorName) {
      validatorNames.push(validatorName);
    };

    this.addConstraintAlias = function (valdrName, alias) {
      if(!angular.isArray(constraintAliases[valdrName])) {
        constraintAliases[valdrName] = [];
      }
      constraintAliases[valdrName].push(alias);
    };

    this.$get =
      ['$log', '$injector', '$rootScope', '$http', '$timeout', 'valdrEvents', 'valdrUtil', 'valdrClasses', '$q',
        function ($log, $injector, $rootScope, $http, $timeout, valdrEvents, valdrUtil, valdrClasses, $q) {

          // inject all validators
          angular.forEach(validatorNames, function (validatorName) {
            var validator = $injector.get(validatorName);
            validators[validator.name] = validator;

            // register validator with aliases
            if(angular.isArray(constraintAliases[validator.name])) {
              angular.forEach(constraintAliases[validator.name], function (alias) {
                validators[alias] = validator;
              });
            }

          });

          // load constraints via $http if constraintUrl is configured
          if (constraintUrl) {
            constraintsLoading = true;
            $http.get(constraintUrl).then(function (response) {
              constraintsLoading = false;
              addConstraints(response.data);
              $rootScope.$broadcast(valdrEvents.revalidate);
            })['finally'](function () {
              constraintsLoading = false;
            });
          }

          var constraintsForType = function (type) {
            if (valdrUtil.has(constraints, type)) {
              return constraints[type];
            } else if (!constraintsLoading) {
              $log.warn('No constraints for type \'' + type + '\' available.');
            }
          };

          return {
            /**
             * Validates the value of the given type with the constraints for the given field name.
             *
             * @param typeName the type name
             * @param fieldName the field name
             * @param value the value to validate
             * @returns {*}
             */
            validate: function (typeName, fieldName, value, getOtherModelsDataOnForm, async) {
              var validResult = { valid: true },
                typeConstraints = constraintsForType(typeName);

              if (valdrUtil.has(typeConstraints, fieldName)) {
                var fieldConstraints = typeConstraints[fieldName],
                  fieldIsValid = true,
                  validationResults = [],
                  violations = [],
                  deferred;

                var hasAsyncValidators = false;
                var validatorsToRun = 0;
                var validatorsRan = 0;
                for (var k in fieldConstraints) {
                  if (fieldConstraints.hasOwnProperty(k) && fieldConstraints[k].async){
                    validatorsToRun++;
                  }
                }

                if(async){
                  deferred = $q.defer();
                }

                angular.forEach(fieldConstraints, function (constraint, validatorName) {
                  
                  var validator = validators[validatorName];
                  var validationResult;

                  if(validator !== undefined && validator.async){
                    hasAsyncValidators = true;
                  }

                  if (angular.isUndefined(validator)) {
                    $log.warn('No validator defined for \'' + validatorName +
                      '\'. Can not validate field \'' + fieldName + '\'');
                    return validResult;
                  }

                  var getRequiredModelsValues = function(constraint){
                    var criteria = function(key){
                      var found = false;
                      angular.forEach(constraint.requireModels, function(modelName){
                        if (key === modelName){
                          found = true;
                          return false;
                        }
                      });
                      return found;
                    };

                    var requireModels = {};
                    angular.forEach(getOtherModelsDataOnForm(criteria), function(modelData, key){
                      requireModels[key] = modelData.$modelValue;
                    });
                    return requireModels;
                  };

                  var getOtherModelsValues = function(fieldName){
                    
                    if(getOtherModelsDataOnForm !== undefined){
                      var criteria = function(key){
                        return fieldName !== key;
                      };
                      return getOtherModelsDataOnForm(criteria);
                    } else {
                      return {};
                    }
                    
                  };

                  var propagateDependentFieldsValidation = function(fieldName, typeName){
                    angular.forEach(getOtherModelsValues(fieldName), function(modelData, key){
                      if(dependencies[typeName][fieldName] !== undefined && dependencies[typeName][fieldName].indexOf(key) >= 0){
                        $timeout(function(){
                          modelData.$validate();
                        });
                      }
                    });
                  };

                  if(!async && (validator.async === false || validator.async === undefined) || async && validator.async){

                    var valid;
                    if(constraint.hasOwnProperty('requireModels')){
                      valid = validator.validate(value, constraint, getRequiredModelsValues(constraint));
                    } else {
                      valid = validator.validate(value, constraint);
                    } 
                    validatorsRan++;
                    
                    if(!async){
                      validationResult = {
                        valid: valid,
                        value: value,
                        field: fieldName,
                        type: typeName,
                        validator: validatorName
                      };
                      angular.extend(validationResult, constraint);
                      validationResults.push(validationResult);
                      if (!valid) {
                        violations.push(validationResult);
                      }
                      fieldIsValid = fieldIsValid && valid;
                      if(validatorsToRun === validatorsRan || !fieldIsValid){
                        propagateDependentFieldsValidation(fieldName, typeName);
                      }
                    } else {
                      validationResult = {
                        valid: undefined,
                        value: value,
                        field: fieldName,
                        type: typeName,
                        validator: validatorName
                      };
                      validationResults.push(validationResult);
                      angular.extend(validationResult, constraint);
                      valid.then(function(){
                        validationResult.valid = true;
                      }).catch(function(){
                        validationResult.valid = true;
                        violations.push(validationResult);
                      }).finally(function(){
                        fieldIsValid = undefined;
                        var finishedRunning = true;
                        angular.forEach(validationResults, function(vr){
                          if (vr.valid !== undefined && fieldIsValid === undefined && vr.valid === true){
                            fieldIsValid = true;
                          } else if(vr.valid !== undefined && vr.valid === false){
                            fieldIsValid = false;
                            return false;
                          } else if(vr.valid === undefined){
                            finishedRunning = false;
                          }
                        });

                        if(fieldIsValid !== undefined && validatorsToRun === validatorsRan && finishedRunning){
                          if(!fieldIsValid){
                            propagateDependentFieldsValidation(fieldName, typeName);
                            deferred.reject();
                          } else {
                            propagateDependentFieldsValidation(fieldName, typeName);
                            deferred.resolve();
                          }
                        }
                      });
                    }
                  }
                });
                if(!async){
                  debugger;
                  return {
                    valid: fieldIsValid,
                    violations: violations.length === 0 ? undefined : violations,
                    validationResults: validationResults.length === 0 ? undefined : validationResults
                  };
                } else {
                  if(hasAsyncValidators){
                    return {
                      valid: deferred.promise,
                      violations: violations,
                      validationResults: validationResults
                    };
                  } else {
                    deferred.resolve();
                    return {
                      valid: deferred.promise,
                      violations: [],
                      validationResults: []
                    };
                  }

                }
              } else {
                return validResult;
              }
            },
            addConstraints: function (newConstraints) {
              addConstraints(newConstraints);
              $rootScope.$broadcast(valdrEvents.revalidate);
            },
            removeConstraints: function (constraintNames) {
              removeConstraints(constraintNames);
              $rootScope.$broadcast(valdrEvents.revalidate);
            },
            getConstraints: function () {
              return constraints;
            },
            setClasses: function (newClasses) {
              angular.extend(valdrClasses, newClasses);
              $rootScope.$broadcast(valdrEvents.revalidate);
            }
          };
        }];
  });